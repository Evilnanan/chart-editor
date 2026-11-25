import { bmsNotes } from './definitions.js';
import { makeProject,makeNote,uid,num,clamp,round,tracks,trackFor,isCurve,isHold,scenes } from './model.js';

const supportedChannels=new Set(['01','11','12','13','14','15','16','18','31','32','33','34','51','52','53','54','D1','D2','D3','D4','SC']);
const airChannels=new Set(['11','13','31','33','51','53','D1','D3']);
const roadChannels=new Set(['12','14','32','34','52','54','D2','D4']);
const longChannels=new Set(['51','52','53','54']);
const shortChannels=new Set(['D1','D2','D3','D4']);
const shapeNames=['easy','hard','master','remaster','special'];
const axisTypeSet=new Set(['vfx_changescene','vfx_visibility','vfx_bossvisibility']);
const definitions=new Map();
for (const entry of bmsNotes) {
  const [code]=entry;
  if(!definitions.has(code)) definitions.set(code,entry);
}
const additional=[
  ['0I','assault','down','track'],['0J','hammer','up','track'],
  ['2P','bms_mosaicon','normal','effect'],['2Q','bms_mosaicoff','normal','effect'],
  ['2R','bms_sepiaon','normal','effect'],['2S','bms_sepiaoff','normal','effect'],
];
for(const entry of additional) definitions.set(entry[0],entry);
const palette=new Set(tracks.map(item=>item.id));
const handledHeaders=new Set(['TITLE','ARTIST','BPM','GENRE','LEVELDESIGN','PLAYLEVEL','WAV10','PLAYER','LNTYPE','EDITOR_DURATION','EDITOR_DIFFICULTY','EDITOR_PREVIEW','EDITOR_METER']);
const sceneAliases={scene_groovecoaster:'scene_groove',scene_10:'scene_miku'};
const laneFor=channel=>airChannels.has(channel)?'air':roadChannels.has(channel)?'road':'effect';

export function decodeText(data) {
  if(data[0]===0xff && data[1]===0xfe) return new TextDecoder('utf-16le').decode(data);
  if(data[0]===0xfe && data[1]===0xff) return new TextDecoder('utf-16be').decode(data);
  try {return new TextDecoder('utf-8',{fatal:true}).decode(data);}
  catch {return new TextDecoder('shift_jis').decode(data);}
}
export function sceneFromBms(scene='') {
  if(/^scene_\d{2}$/.test(scene)) return scenes[num(scene.slice(-2))-1]?.[0] || scene;
  return sceneAliases[scene] || scene || 'scene_factory';
}
export function sceneToBms(scene) {
  if(/^scene_\d{2}$/.test(scene)) return scene;
  return 'scene_'+String(Math.max(0,scenes.findIndex(([id])=>id===scene))+1).padStart(2,'0');
}
export const difficultyIndex=kind=>({easy:1,hard:2,master:3,remaster:4,special:5,color:5})[kind] || 3;
export const indexDifficulty=index=>shapeNames[index-1] || 'master';
const clean=value=>String(value ?? '').replace(/[\r\n]/g,' ').trim();

function assertBpm(bpm) {
  if(!Number.isFinite(bpm)||bpm<=0||bpm>9999) throw new Error('BMS 的 BPM 无效');
}
function parseTable(text) {
  const headers=Object.create(null);
  const measures=new Map();
  const rows=[];
  for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const hit=line.trim().match(/^#(\d{3})([\dA-Z]{2}):\s*(\S+)/i);
    if(hit) {
      const [,barString,channelString,dataString]=hit;
      const bar=Number(barString),channel=channelString.toUpperCase(),value=dataString.toUpperCase();
      if(channel==='02') {
        const ratio=Number(value);
        if(ratio>0 && ratio<=64) measures.set(bar,ratio);
      } else if(value.length%2===0 && /^[A-Z0-9]+$/.test(value)) {
        for(let i=0;i<value.length;i+=2) {
          const code=value.slice(i,i+2);
          if(code==='00') continue;
          rows.push({tick:bar+i/value.length,channel,code,source:rows.length});
        }
      }
      continue;
    }
    const header=line.trim().match(/^#([A-Z0-9_]+)[ \t]+(.*)$/i);
    if(header) headers[header[1].toUpperCase()]=header[2].trim();
  }
  if(!('BPM' in headers)) throw new Error('找不到 BMS 的 #BPM 标签');
  assertBpm(Number(headers.BPM));
  rows.sort((a,b)=>a.tick-b.tick || (a.channel==='15'?-1:b.channel==='15'?1:a.source-b.source));
  return {headers,measures,rows};
}
function makeClock(base,ratios,changes,last) {
  const spans=[];
  let bpm=base;
  let time=0;
  let cursor=0;
  for(let measure=0;measure<=last;measure++) {
    let tick=measure;
    const ratio=ratios.get(measure) || 1;
    while(cursor<changes.length && changes[cursor].tick<measure+1-1e-10) {
      const change=changes[cursor++];
      if(change.tick>tick) {
        spans.push({tick,time,bpm,ratio});
        time+=(change.tick-tick)*240/bpm*ratio;
        tick=change.tick;
      }
      bpm=change.bpm;
    }
    spans.push({tick,time,bpm,ratio});
    time+=(measure+1-tick)*240/bpm*ratio;
  }
  const byTick=tick=>spans[Math.max(0,findSpan(spans,'tick',tick))];
  const byTime=time=>spans[Math.max(0,findSpan(spans,'time',time))];
  return {
    time(tick) {const span=byTick(tick);return span.time+(tick-span.tick)*240/span.bpm*span.ratio;},
    tick(time) {const span=byTime(time);return span.tick+(time-span.time)*span.bpm/(240*span.ratio);},
  };
}
function findSpan(spans,key,value) {
  let low=0,high=spans.length;
  while(low<high) {
    const mid=(low+high)>>>1;
    if(spans[mid][key]<=value+1e-9) low=mid+1;
    else high=mid;
  }
  return low-1;
}
function meter(ratio) {
  for(const denominator of [4,8,16,32,2,1]) {
    const numerator=Math.round(ratio*denominator);
    if(numerator>=1 && numerator<=64 && Math.abs(numerator/denominator-ratio)<1e-6) return {numerator,denominator};
  }
  return {numerator:clamp(Math.round(ratio*32),1,64),denominator:32};
}
function speedDefinition(token) {
  const found=definitions.get(token);
  if(found?.[1]!=='bms_spdctrl') return null;
  return {lane:found[2].slice(0,-1),speed:Number(found[2].slice(-1))};
}

export function parseBms(data,name='chart.bms',override={}) {
  const text=typeof data==='string'?data:decodeText(data);
  const {headers,measures,rows}=parseTable(text);
  const bpm=Number(headers.BPM);
  const changes=rows.filter(row=>row.channel==='03'||row.channel==='08').map(({tick,code,channel})=>({
    tick,bpm:channel==='03'?Number.parseInt(code,16):num(headers['BPM'+code]),
  })).filter(item=>item.bpm>0&&item.bpm<=9999);
  const maxBar=Math.max(1,Math.floor(rows.at(-1)?.tick || 0),...measures.keys());
  const clock=makeClock(bpm,measures,changes,maxBar+1);
  const initialMeter=(headers.EDITOR_METER || '').split('/').map(Number);
  const preview=(headers.EDITOR_PREVIEW || '').split(',').map(Number);
  const project=makeProject({
    name:headers.TITLE || name.replace(/\.bms$/i,''),
    artist:headers.ARTIST || '',designer:headers.LEVELDESIGN || '',
    level:headers.PLAYLEVEL || '0',
    difficulty:headers.EDITOR_DIFFICULTY || indexDifficulty(num(name.match(/map([1-5])\.bms/i)?.[1],3)),
    bpm,...meter(measures.get(0) || 1),
    ...(initialMeter[0]>0&&initialMeter[1]>0?{numerator:initialMeter[0],denominator:initialMeter[1]}:{}),
    duration:Math.max(num(headers.EDITOR_DURATION),clock.time(rows.at(-1)?.tick || 0)+.3,1),
    previewStart:preview[0] || 0,previewEnd:preview[1] || 0,
    scene:sceneFromBms(headers.GENRE),format:'bms',audioName:headers.WAV10 || 'music.ogg',
    bmsHeaders:Object.fromEntries(Object.entries(headers).filter(([key])=>!handledHeaders.has(key)&&!/^BPM[A-Z0-9]{2}$/.test(key))),
    bmsSourceName:name, ...override,
  });
  const transitionTicks=new Set(changes.map(change=>change.tick));
  for(let bar=1;bar<=maxBar;bar++) {
    if((measures.get(bar)||1)!==(measures.get(bar-1)||1)) transitionTicks.add(bar);
  }
  let activeBpm=bpm;
  for(const tick of [...transitionTicks].sort((a,b)=>a-b)) {
    activeBpm=changes.findLast(change=>change.tick<=tick)?.bpm || bpm;
    const signature=meter(measures.get(Math.floor(tick)) || 1);
    if(tick===0) {project.bpm=activeBpm;continue;}
    project.tempos.push({id:uid(),time:round(clock.time(tick)),bpm:activeBpm,...signature});
  }
  project.bmsClock={
    base:bpm,ratios:[...measures],changes,last:maxBar,signature:clockSignature(project),
  };
  const speeds={air:2,road:2};
  const pending=new Map(),hearts=[];
  const noteList=project.notes;
  for(const {tick,code,channel} of rows) {
    if(channel==='03'||channel==='08') continue;
    const time=round(clock.time(tick));
    if(channel==='01' && code==='10') {project.bmsMusicTime=time;continue;}
    const lane=laneFor(channel);
    if(channel.startsWith('3') && (airChannels.has(channel)||roadChannels.has(channel))) {
      hearts.push({time,lane,channel,code});continue;
    }
    const definition=definitions.get(code);
    if(!definition || !supportedChannels.has(channel) || !palette.has(lane)) {
      noteList.push(makeNote('bms_aux',time,lane,0,{track:lane,bmsCode:code,bmsChannel:channel}));
      continue;
    }
    const [,type,stage,behavior]=definition;
    const speed=speedDefinition(code);
    if(speed) {
      for(const [target,key] of [['road','road'],['air','air']]) if(speed.lane==='both' || speed.lane===key) speeds[target]=speed.speed;
      noteList.push(makeNote(type,time,'effect',0,{value:speed.speed,bmsSpeedLane:speed.lane,bmsChannel:channel,bmsCode:code}));
      continue;
    }
    const actualLane=behavior==='action'?'action':behavior==='effect'?'effect':lane==='effect'?'road':lane;
    const props={track:actualLane,speed:speeds[actualLane] || 2,direction:['up','down'].includes(stage)?stage:'normal',bmsCode:code,bmsChannel:channel};
    if(type==='vfx_changescene') props.value=sceneFromBms(stage);
    if(['vfx_visibility','vfx_bossvisibility'].includes(type)) props.value=stage==='true';
    if(code==='0G'&&actualLane==='air') props.direction='down';
    if(shortChannels.has(channel)&&type==='long') {
      noteList.push(makeNote('long_short',time,actualLane,0,{...props,end:round(time+.06)}));
      continue;
    }
    if(longChannels.has(channel)&&isHold(type)) {
      const key=channel;
      const start=pending.get(key);
      if(start) {
        start.end=time;start.bmsEndCode=code;pending.delete(key);
      } else {
        const item=makeNote(type,time,actualLane,0,props);
        pending.set(key,item);noteList.push(item);
      }
    } else {
      const item=makeNote(type,time,actualLane,0,props);
      if(axisTypeSet.has(type)) {
        let axis=project.axes.find(axis=>axis.type===type);
        if(!axis) {axis={id:uid(),layer:0,type};project.axes.push(axis);}
        item.axisId=axis.id;
      }
      noteList.push(item);
    }
  }
  for(const {time,lane,channel,code} of hearts) {
    const matching=noteList.find(note=>note.track===lane&&note.time===time&&note.bmsCode===code)
      || noteList.find(note=>note.track===lane&&note.time===time);
    if(matching) {matching.heart=true;matching.bmsHeartChannel=channel;matching.bmsHeartCode=code;}
    else noteList.push(makeNote('special_hp',time,lane,0,{bmsCode:code,bmsChannel:channel}));
  }
  project.notes.sort((a,b)=>a.time-b.time);
  project.duration=Math.max(project.duration,...project.notes.map(note=>note.end+.01));
  return project;
}

function clockSignature(project) {
  return JSON.stringify([project.bpm,project.numerator,project.denominator,project.offset,project.tempos.map(({time,bpm,numerator,denominator})=>[time,bpm,numerator,denominator])]);
}
function exportClock(project,lastTime) {
  if(project.bmsClock?.signature===clockSignature(project)) {
    const {base,ratios,changes,last}=project.bmsClock;
    const ratioMap=new Map(ratios);
    const clock=makeClock(base,ratioMap,changes,Math.max(last+3,999));
    return {base,ratios:ratioMap,changes,clock};
  }
  const changes=[];
  const ratios=new Map();
  const sections=[{time:0,bpm:project.bpm,numerator:project.numerator,denominator:project.denominator},
    ...project.tempos.filter(tempo=>tempo.time>0).sort((a,b)=>a.time-b.time)];
  let bar=0;
  for(let i=0;i<sections.length;i++) {
    const part=sections[i], next=sections[i+1]?.time || lastTime;
    const ratio=part.numerator/part.denominator;
    const span=ratio*240/part.bpm;
    if(i) changes.push({tick:bar,bpm:part.bpm});
    const count=Math.max(1,Math.ceil((next-part.time)/span-1e-7));
    if(bar+count>1000) throw new Error('BMS 格式最多支持 1000 小节');
    for(let piece=0;piece<count;piece++) {
      const remaining=next-part.time-piece*span;
      const actual=i+1<sections.length ? Math.max(.000001,Math.min(1,remaining/span))*ratio : ratio;
      if(Math.abs(actual-1)>1e-7) ratios.set(bar,actual);
      bar++;
    }
  }
  const base=sections[0].bpm;
  return {base,ratios,changes,clock:makeClock(base,ratios,changes,Math.min(999,bar+1))};
}
function findCode(note) {
  if(note.type==='bms_aux') return note.bmsCode;
  if(note.type==='bms_spdctrl') {
    const direction=(note.bmsSpeedLane||'both')+Math.round(clamp(num(note.value,2),1,3));
    return bmsNotes.find(row=>row[1]===note.type&&row[2]===direction)?.[0];
  }
  if(note.type==='vfx_changescene') {
    return bmsNotes.find(row=>row[1]===note.type&&sceneFromBms(row[2])===note.value)?.[0];
  }
  if(['vfx_visibility','vfx_bossvisibility'].includes(note.type)) {
    return bmsNotes.find(row=>row[1]===note.type&&row[2]===String(note.value))?.[0];
  }
  if(note.type==='vfx_vignette') return note.value>0?'2E':'2F';
  const byType=[...definitions.values()].filter(row=>row[1]===note.type);
  const exact=byType.find(row=>row[2]===note.direction);
  if(note.type==='long_short') return '0F';
  if(note.bmsCode && definitions.get(note.bmsCode)?.[1]===note.type &&
    (definitions.get(note.bmsCode)?.[2]===note.direction || !exact)) return note.bmsCode;
  return exact?.[0] || byType[0]?.[0];
}
function channelFor(note,code) {
  if(note.type==='bms_aux') return note.bmsChannel;
  const entry=definitions.get(code);
  if(note.bmsChannel && note.bmsCode===code && laneFor(note.bmsChannel)===note.track) return note.bmsChannel;
  if(entry?.[3]==='action' || entry?.[3]==='effect') return code>='25'?'18':'15';
  if(note.type==='long_short') return note.track==='air'?'D3':'D4';
  if(isHold(note.type)) return note.track==='air'?'53':'54';
  if(note.bmsChannel && code===note.bmsCode && note.bmsChannel.startsWith('3')) return note.bmsChannel;
  return note.track==='air'?'13':'14';
}
function encodeRows(events) {
  const groups=new Map();
  for(const {tick,channel,code} of events) {
    if(!code||!/^[A-Z0-9]{2}$/.test(code) || tick<-.0000001) continue;
    const bar=Math.floor(tick+1e-7);
    if(bar>999) throw new Error('BMS 格式最多支持 1000 小节');
    const key=String(bar).padStart(3,'0')+channel;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push([clamp(tick-bar,0,.999999999),code]);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([key,items])=>{
    const maxGrid=768;
    const count=Array.from({length:maxGrid},(_,i)=>i+1).find(n=>items.every(([beat])=>Math.abs(Math.round(beat*n)/n-beat)<.000006)) || 4096;
    const layers=[];
    for(const [part,code] of items) {
      const index=Math.min(count-1,Math.round(part*count));
      let row=layers.find(cells=>cells[index]==='00');
      if(!row) {row=Array(count).fill('00');layers.push(row);}
      row[index]=code;
    }
    return layers.map(row=>'#'+key+':'+row.join(''));
  });
}

export function bmsLoss(project) {
  const notes=project.notes;
  return [
    ...(notes.some(isCurve)?['曲线长条 / curve holds']:[]),
    ...(notes.some(note=>!findCode(note) && !isCurve(note))?['MDCP 专用对象 / MDCP-only objects']:[]),
    ...(notes.some(note=>note.baseColor||note.gradient||note.hsv||note.stayTexture)?['音符颜色 / note colors']:[]),
    ...(project.layers.length>1?['层级 / layers']:[]),
    ...(notes.some(note=>note.easing && note.easing!=='NULL')?['关键帧插值 / keyframe interpolation']:[]),
    ...(project.offset?['格线偏移 / grid offset']:[]),
  ];
}

export function serializeBms(project,audioName=project.audioName || 'music.ogg') {
  const {base,ratios,changes,clock}=exportClock(project,Math.max(project.duration,...project.notes.map(note=>note.end))+.1);
  const header={
    ...project.bmsHeaders,PLAYER:1,GENRE:sceneToBms(project.scene),TITLE:project.name,ARTIST:project.artist,
    LEVELDESIGN:project.designer,BPM:base,PLAYLEVEL:project.level,LNTYPE:1,WAV10:audioName,
    EDITOR_DURATION:round(project.duration),EDITOR_DIFFICULTY:project.difficulty,
    EDITOR_PREVIEW:[project.previewStart,project.previewEnd].join(','),EDITOR_METER:project.numerator+'/'+project.denominator,
  };
  const bpmCodes=new Map();
  const bpmEvents=[];
  for(const change of changes) {
    if(!bpmCodes.has(change.bpm)) {
      if(bpmCodes.size>=1295) throw new Error('BMS 变速值数量超过上限');
      const code=(bpmCodes.size+1).toString(36).padStart(2,'0').toUpperCase();
      bpmCodes.set(change.bpm,code);header['BPM'+code]=change.bpm;
    }
    bpmEvents.push({tick:change.tick,channel:'08',code:bpmCodes.get(change.bpm)});
  }
  const events=[{tick:clock.tick(project.bmsMusicTime || 0),channel:'01',code:'10'}];
  const speed={air:2,road:2};
  for(const note of [...project.notes].sort((a,b)=>a.time-b.time || (a.type==='bms_spdctrl'?-1:b.type==='bms_spdctrl'?1:0))) {
    const code=findCode(note);
    if(!code || note.time<0 || isCurve(note)) continue;
    const channel=channelFor(note,code);
    const tick=clock.tick(note.time);
    const change=speedDefinition(code);
    if(change) {
      for(const lane of ['air','road']) if(change.lane===lane||change.lane==='both') speed[lane]=change.speed;
    } else if((note.track==='air'||note.track==='road') && note.type!=='bms_aux' && speed[note.track]!==note.speed) {
      const nextSpeed=clamp(Math.round(num(note.speed,2)),1,3);
      const speedCode=bmsNotes.find(row=>row[1]==='bms_spdctrl'&&row[2]===note.track+nextSpeed)?.[0];
      if(speedCode) events.push({tick,channel:'15',code:speedCode});
      speed[note.track]=nextSpeed;
    }
    events.push({tick,channel,code});
    if(isHold(note.type) && note.type!=='long_short' && note.end>note.time) events.push({tick:clock.tick(note.end),channel,code:note.bmsEndCode || code});
    if(note.heart) events.push({tick,channel:note.bmsHeartChannel || (note.track==='air'?'33':'34'),code:note.bmsHeartCode || code});
  }
  const meterRows=[...ratios].sort(([a],[b])=>a-b).map(([bar,ratio])=>'#'+String(bar).padStart(3,'0')+'02:'+Number(ratio.toFixed(10)));
  return [...Object.entries(header).map(([key,value])=>'#'+key+' '+clean(value)),'',...meterRows,...encodeRows(bpmEvents),...encodeRows(events),''].join('\r\n');
}
