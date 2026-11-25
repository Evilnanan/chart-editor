import { makeProject,makeNote,uid,num,round,clamp,groups,playable,isHold,isCurve,isAxis,easings,trackFor } from './model.js';
import { heartTypes } from './definitions.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const curveFromCode={s:'Linear',b:'Bezier',ei:'EaseIn',eo:'EaseOut'};
const curveCode=Object.fromEntries(Object.entries(curveFromCode).map(([code,name])=>[name,code]));
const globalEffects=new Set(groups.effect.filter(type=>type!=='effect_timing'));
const validNoteIds=new Set(Object.values(groups).flat());
const escapeText=value=>String(value ?? '').replaceAll(',', '[:comma]').replace(/[\r\n]/g,' ');
const unescapeText=value=>String(value ?? '').replaceAll('[:comma]',',');
const float=value=>String(round(num(value)));

export function decodeMdcpmf(input) {
  if(typeof input==='string') return input;
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  try {
    const text=decoder.decode(bytes);
    if(/^\s*(?:\/\/[^\n]*\s*)*mapinfo\(/i.test(text)) return text;
  } catch {}
  if(bytes.length%2!==0) throw new Error('MDCPMF 长度无效');
  const plain=new Uint8Array(bytes.length/2);
  for(let i=0;i<plain.length;i++) plain[i]=bytes[i*2]-bytes[i*2+1];
  try {return decoder.decode(plain);}
  catch {throw new Error('无法读取 MDCPMF 数据');}
}

export function encodeMdcpmf(text) {
  // Each byte is stored as a pair whose difference is the original UTF-8 byte.
  const bytes=encoder.encode(text);
  const result=new Uint8Array(bytes.length*2);
  const random=new Uint8Array(Math.min(65536,bytes.length));
  for(let i=0;i<bytes.length;i++) {
    if(i%65536===0) crypto.getRandomValues(random);
    const mask=random[i%65536]%(256-bytes[i]);
    result[i*2]=bytes[i]+mask;result[i*2+1]=mask;
  }
  return result;
}

const readArgs=raw=>Object.fromEntries((raw || '').split('|').filter(item=>item.includes('=')).map(item=>{
  const i=item.indexOf('=');
  return [item.slice(0,i),item.slice(i+1)];
}));

function findType(raw,entrance,end) {
  if(raw==='long_road'||raw==='long_air') {
    if(entrance==='curve'||entrance==='curve_short') return 'curvehold_'+(raw.endsWith('road')?'red':'blue')+(entrance==='curve_short'?'_short':'');
    return entrance==='short'||end<0 ? 'long_short' : 'long';
  }
  if(raw==='double_ra') return 'double';
  if(raw==='punch_ra') return 'punch';
  if(raw.startsWith('curvehold_')) return raw;
  const base=raw.replace(/_(road|air|middle)$/, '');
  return validNoteIds.has(base)?base:raw;
}
function axisNote(project,type,layer,time,value,easing) {
  const actualLayer=globalEffects.has(type) && layer===0 ? -1 : layer;
  let axis=project.axes.find(axis=>axis.type===type&&axis.layer===actualLayer);
  if(!axis) {axis={id:uid(),type,layer:actualLayer};project.axes.push(axis);}
  if(type==='vfx_visibility'||type==='vfx_bossvisibility') value=String(value).toLowerCase()!=='false' && value!=='0';
  else if(type==='vfx_changescene') value=String(value);
  else value=num(value,0);
  easing=easings[num(easing,-1)]?.[0] || easings.find(([name])=>name.toLowerCase()===String(easing).toLowerCase())?.[0] || 'NULL';
  return makeNote(type,time,'effect',actualLayer,{axisId:axis.id,value,easing});
}

function parseCurve(raw,start,end,position) {
  const nodes=(raw || '').split('/').map(token=>{
    const [code,time,y]=token.split(':');
    if(!Object.hasOwn(curveFromCode,code)||!Number.isFinite(Number(time))||!Number.isFinite(Number(y))) return null;
    return {curve:curveFromCode[code],time:Number(time),position:Number(y)};
  }).filter(Boolean);
  if(!nodes.length || nodes[0].time>start+.00001) nodes.unshift({time:start,position,curve:'Linear'});
  if(nodes.length===1) nodes.push({time:Math.max(end,start+.001),position:nodes[0].position,curve:'Linear'});
  return nodes.sort((a,b)=>a.time-b.time);
}
function parseNote(args,layer,project) {
  const [raw,timeRaw,entrance,endRaw,exit,speedRaw,...extra]=args;
  const time=Number(timeRaw);
  if(!Number.isFinite(time)) throw new Error('MDCPMF 中的音符时间无效');
  if(isAxis(raw)) return axisNote(project,raw,layer,time,entrance,exit);
  const end=num(endRaw,-1);
  const type=findType(raw,entrance,end);
  const lane=raw.endsWith('_air')?'air':'road';
  const effect=raw.startsWith('bms_')&&(raw!=='bms_touhou_ppoint');
  const track=effect?'effect':trackFor(type,lane);
  const rawExtra=extra.join(',');
  const curveRaw=rawExtra.split('|')[0];
  const extraArgs=readArgs(isCurve({type})?rawExtra.slice(curveRaw.length):rawExtra);
  const note=makeNote(type,time,lane,layer,{
    track,end:end>=0 ? end : type==='long_short'?round(time+.06):time,
    direction:['up','down'].includes(entrance)?entrance:'normal',
    speed:clamp(Math.round(num(speedRaw,2)),1,3),
    mdcpRaw:{type:raw,entrance,exit,extra:rawExtra},extraArgs,
  });
  if(isCurve(note)) {
    note.nodes=parseCurve(curveRaw,time,end,type.includes('red')?0:1);
    note.time=note.nodes[0].time;note.end=note.nodes.at(-1).time;
    if(Math.abs(note.end-note.time)<=.00001) note.end=note.time+.001;
  }
  if(raw==='punch_ra'&&(entrance==='down'||entrance==='air')) {note.track='air';note.direction='down';}
  if(extraArgs.hsv_offset!==undefined) note.hsv=extraArgs.hsv_offset.replaceAll('~','^');
  if(extraArgs.hsv_grad!==undefined) {
    const values=extraArgs.hsv_grad.split('~');
    if(values.length===8) {
      note.gradientStart=values.slice(0,4).join('^');
      note.gradient=values.slice(4).join('^');
    } else {
      const [start,end]=extraArgs.hsv_grad.split('/');
      note.gradientStart=start;
      note.gradient=end || start;
    }
  }
  if(extraArgs.base_color!==undefined) note.baseColor=extraArgs.base_color;
  if(extraArgs.hsv_stay_tex!==undefined) note.stayTexture=['true','1'].includes(extraArgs.hsv_stay_tex.toLowerCase());
  if(extraArgs.heart!==undefined) note.heart=['true','1'].includes(extraArgs.heart.toLowerCase());
  return note;
}

export function parseMdcpmf(input) {
  const text=decodeMdcpmf(input).replace(/^\uFEFF/,'');
  const info=text.match(/^\s*mapinfo\((.*)\);\s*$/m)?.[1];
  if(!info) throw new Error('MDCPMF 缺少 mapinfo');
  const [nativeId,name,artist,designer,difficulty,level,bpm,duration,start,end,scene,total]=info.split(',').map(unescapeText);
  if(!name||num(bpm)<=0) throw new Error('MDCPMF 的标题或 BPM 无效');
  const editor=text.match(/^\s*editorinfo\((.*)\);\s*$/m)?.[1]?.split(',') || [];
  const project=makeProject({
    name,artist,designer,difficulty,level,scene:scene || 'scene_candy',bpm:num(bpm,128),
    duration:Math.max(1,num(duration,60)),previewStart:num(start),previewEnd:num(end),
    denominator:clamp(num(editor[4],4),1,64),numerator:clamp(num(editor[3],4),1,64),
    nativeId,mdcpTotal:num(total),mdcpDivision:clamp(num(editor[0],4),1,384),mdcpGrid:String(editor[1]).toLowerCase()!=='false',
    layers:[],format:'mdcpmf',
  });
  const data=text.match(/editordata\s*\{([\s\S]*?)\}/i)?.[1] || '';
  const layerNames=new Map();
  for(const [,kind,raw] of data.matchAll(/^\s*(bpmbeatblock|layercaption)\((.*)\);\s*$/gm)) {
    const args=raw.split(',');
    if(kind==='layercaption') layerNames.set(num(args[0]),unescapeText(args.slice(1).join(',')));
    else {
      const [time,bpm,numerator,denominator]=args.map(Number);
      if(time>0 && bpm>0 && numerator>0 && denominator>0) project.tempos.push({id:uid(),time,bpm,numerator,denominator});
    }
  }
  const layers=[...text.matchAll(/^\s*maplayer\s*\{([\s\S]*?)\}/gim)];
  if(!layers.length) throw new Error('MDCPMF 缺少 maplayer');
  if(layers.length>1000) throw new Error('MDCPMF 层级过多');
  for(const [layer,block] of layers.entries()) {
    project.layers.push({id:layer,name:layerNames.get(layer) || (layer===0?'主谱面':'层级 '+layer),visible:true});
    for(const line of block[1].trim().split(/\r?\n/)) {
      const match=line.trim().match(/^(note|timing|scene_timing)\((.*)\);$/i);
      if(!match) {
        if(line.trim()&&!line.trim().startsWith('//')) (project.mdcpOther ??= []).push({layer,line});
        continue;
      }
      const [,kind,body]=match;
      const args=body.split(',');
      if(kind==='note') project.notes.push(parseNote(args,layer,project));
      else project.notes.push(axisNote(project,kind==='timing'?'effect_timing':'effect_scene_timing',layer,num(args[0]),args[1],'NULL'));
    }
  }
  for(const heart of project.notes.filter(note=>note.type==='special_hp')) {
    const target=project.notes.find(note=>heartTypes.includes(note.type)&&note.time===heart.time&&note.layer===heart.layer&&note.track===heart.track);
    if(target) {target.heart=true;heart.attached=true;}
  }
  project.notes=project.notes.filter(note=>!note.attached);
  return project;
}

function noteId(note) {
  const {type,track}=note;
  if(isCurve(note)) return type.endsWith('_short')?type:'long_'+track;
  if(type==='long'||type==='long_short') return type+'_'+track;
  if(type==='double'||type==='punch') return type+'_ra';
  if(playable(note) && !type.startsWith('boss_ra_atk_') && !type.startsWith('boss_ra_punch')) return type+'_'+track;
  return type;
}

function writeNote(note) {
  const type=note.type;
  if(type==='effect_timing') return `timing(${float(note.time)},${float(note.value)});`;
  if(type==='effect_scene_timing') return `scene_timing(${float(note.time)},${float(note.value)});`;
  if(isAxis(type)) return `note(${type},${float(note.time)},${String(note.value)},-1,${note.easing || 'NULL'},3);`;
  const native=note.mdcpRaw;
  const rawType=validNoteIds.has(type)?noteId(note):native?.type || type;
  const entrance=isCurve(note)?'curve':type==='punch'?(note.track==='air'?'down':'normal'):note.direction || 'normal';
  const end=isCurve(note)||isHold(type)&&type!=='long_short'?float(note.end):'-1';
  const exit=isCurve(note)?'NULL':native?.exit || 'NULL';
  const extra={...note.extraArgs};
  delete extra.heart;
  if(note.hsv) extra.hsv_offset=note.hsv.split(/[~^]/).slice(0,3).join('~');else delete extra.hsv_offset;
  if(note.baseColor) extra.base_color=note.baseColor;else delete extra.base_color;
  if(note.gradient || note.gradientStart) extra.hsv_grad=[note.gradientStart || '0^0^0^1',note.gradient || '0^0^0^1'].join('^').replaceAll('^','~');else delete extra.hsv_grad;
  if(note.stayTexture) extra.hsv_stay_tex='true';else delete extra.hsv_stay_tex;
  const pairs=Object.entries(extra).map(([key,value])=>key+'='+String(value).replace(/[,\r\n]/g,''));
  let payload=pairs.join('|');
  if(isCurve(note)) {
    const nodes=note.nodes.map(node=>`${curveCode[node.curve] || 's'}:${float(node.time)}:${float(node.position)}`);
    payload=nodes.join('/')+(payload?'|'+payload:'');
  } else if(!validNoteIds.has(type) && native?.extra && !payload) payload=native.extra;
  return `note(${rawType},${float(note.time)},${entrance},${end},${exit},${note.speed}${payload?','+payload:''});`;
}

export function mdcpLoss(project) {
  const hasBms=project.notes.some(note=>note.type.startsWith('bms_'));
  return [
    ...(hasBms?['BMS 专用事件 / BMS-only events']:[]),
    ...(project.offset?['格线偏移 / grid offset']:[]),
  ];
}

export function serializeMdcpmfText(project) {
  const notes=project.notes.filter(note=>!note.type.startsWith('bms_'));
  const result=['// Generated by Chart Studio','',
    'mapinfo('+[project.nativeId || 'NOID_CHART',escapeText(project.name),escapeText(project.artist),
      escapeText(project.designer),escapeText(project.difficulty),escapeText(project.level),float(project.bpm),float(project.duration),
      float(project.previewStart),float(project.previewEnd),project.scene,notes.length].join(',')+');','',
    `editorinfo(${project.mdcpDivision || 4},${project.mdcpGrid===false?'False':'True'},0,${project.numerator},${project.denominator});`,'','editordata{',
    ...[...project.tempos].sort((a,b)=>a.time-b.time).map(item=>`bpmbeatblock(${float(item.time)},${float(item.bpm)},${item.numerator},${item.denominator});`),
    ...project.layers.map(({name},index)=>`layercaption(${index},${escapeText(name)});`),'}','',
  ];
  for(const [index,layer] of project.layers.entries()) {
    result.push('maplayer{');
    for(const note of notes.filter(note=>note.layer===layer.id || (index===0 && note.layer===-1)).sort((a,b)=>a.time-b.time)) {
      result.push(writeNote(note));
      if(note.heart && heartTypes.includes(note.type)) {
        result.push(`note(special_hp_${note.track},${float(note.time)},normal,-1,NULL,${note.speed});`);
      }
    }
    result.push(...(project.mdcpOther || []).filter(item=>item.layer===layer.id).map(item=>item.line),'}','');
  }
  return result.join('\r\n');
}
export const serializeMdcpmf=project=>encodeMdcpmf(serializeMdcpmfText(project));
