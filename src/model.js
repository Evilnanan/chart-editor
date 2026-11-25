import { bmsNotes, heartTypes, noteNames } from './definitions.js';

export const uid = () => globalThis.crypto.randomUUID();
export const clone = data => structuredClone(data);
export const round = n => Math.round(n * 1e7) / 1e7;
export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
export const num = (value, fallback = 0) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;

export const tracks = [
  { id: 'air', name: '天空轨', en: 'Air', ja: '空中', color: '#ffaf7a', icon: 'cloud' },
  { id: 'road', name: '地面轨', en: 'Ground', ja: '地上', color: '#b8a2ff', icon: 'layers' },
  { id: 'action', name: '动作', en: 'Actions', ja: 'アクション', color: '#f598c1', icon: 'activity' },
  { id: 'effect', name: '特效', en: 'Effects', ja: 'エフェクト', color: '#8eabea', icon: 'sparkles' },
  { id: 'tempo', name: '节拍', en: 'Tempo', ja: 'テンポ', color: '#f4d889', icon: 'metronome' },
];

export const groups = {
  normal: ['small_1','mid_1','mid_2','large_1','large_2','ghost','assault','hammer','gear','long','long_short','double','punch','special_note','special_hp','special_pigeon'],
  action: ['boss_ra','boss_ra_out','boss_ra_far_atk_1','boss_ra_far_atk_2','boss_ra_far_atk_3','boss_ra_gear','boss_ra_atk_1','boss_ra_atk_1_wait','boss_ra_punch','boss_ra_punch_out','boss_ra_far_atk_1_action_start','boss_ra_far_atk_1_action_end','boss_ra_far_atk_2_action_start','boss_ra_far_atk_2_action_end','boss_ra_far_atk_1_to_2_action','boss_ra_far_atk_2_to_1_action'],
  effect: ['effect_timing','effect_scene_timing','vfx_changescene','vfx_visibility','vfx_bossvisibility','vfx_vignette','vfx_bloom','vfx_bgluminance','vfx_grayscale'],
  tempo: ['preset_beatbpm'],
  mdcp: ['curvehold_red','curvehold_blue','curvehold_red_short','curvehold_blue_short'],
  bms: [...new Set(bmsNotes.filter(([,type]) => type.startsWith('bms_') && type !== 'bms_music').map(([,type]) => type))],
};

export const noteTypeNames = (type, lang = 'zh_cn') =>
  noteNames[lang]?.[type] || noteNames.en_us[type] || ({bms_spdctrl:lang === 'zh_cn' ? 'BMS 流速' : 'BMS speed', bms_aux:'BMS event'})[type] || type;

export const scenes = [
  ['scene_factory','太空','#777bff'],['scene_modern','都市','#4f9de8'],['scene_castle','城堡','#aa7898'],
  ['scene_city','雨天','#579ca5'],['scene_candy','糖果','#f483b0'],['scene_wafuu','和风','#e69769'],
  ['scene_groove','GC','#7b87e9'],['scene_touhou','东方','#df5858'],['scene_djmax','DJMAX','#69d3ed'],
  ['scene_miku','初音','#65deb8'],['scene_china','国风','#e2a55f'],
];
export const difficulties = ['easy','hard','master','remaster','special','color'];
export const curves = [['Linear','线性'],['Bezier','贝塞尔'],['EaseIn','渐入'],['EaseOut','渐出']];
export const easings = [['NULL','常量'],['Linear','线性'],['InSine','渐入 I'],['OutSine','渐出 I'],['InOutSine','渐入渐出 I'],['InQuad','渐入 II'],['OutQuad','渐出 II'],['InOutQuad','渐入渐出 II'],['InCubic','渐入 III'],['OutCubic','渐出 III'],['InOutCubic','渐入渐出 III']];
export const baseColors = [['','默认'],['red','红'],['blue','蓝'],['white','白'],['black','黑']];
export const playable = note => ['air','road'].includes(note.track);
export const isCurve = note => note.type.startsWith('curvehold_');
export const isHold = type => ['long','long_short','punch','boss_ra_punch','boss_ra_punch_out'].includes(type) || type.startsWith('curvehold_');
export const defaultLength = type => type.includes('short') ? 0.08 : isHold(type) ? 0.65 : 0;
export const isAxis = type => groups.effect.includes(type);
export const isGlobalAxis = type => isAxis(type) && type !== 'effect_timing';
export const groupOf = type => Object.keys(groups).find(group => groups[group].includes(type)) || 'normal';
export const noteIcon = type => {
  if (isHold(type)) return type.includes('curve') ? 'curve' : 'minus';
  if (type.includes('gear')) return 'triangle';
  if (type.includes('hp')) return 'heart';
  if (type === 'special_note' || type === 'bms_touhou_ppoint') return 'music';
  if (type === 'double') return 'copy';
  if (type === 'ghost') return 'ghost';
  if (type.includes('timing') || type === 'preset_beatbpm') return 'metronome';
  if (groupOf(type) === 'effect' || groupOf(type) === 'bms' && type !== 'bms_touhou_ppoint') return 'sparkles';
  if (groupOf(type) === 'action') return 'activity';
  return type.startsWith('large') ? 'diamond' : 'circle';
};

const playableActions = ['boss_ra_atk_1','boss_ra_atk_1_wait','boss_ra_far_atk_1','boss_ra_far_atk_2','boss_ra_far_atk_3','boss_ra_punch','boss_ra_punch_out','boss_ra_gear','special_pigeon'];
export function trackFor(type, target = 'road') {
  const group = groupOf(type);
  if (group === 'tempo') return 'tempo';
  if (group === 'effect' || group === 'bms' && type !== 'bms_touhou_ppoint') return 'effect';
  if (group === 'action' && !playableActions.includes(type)) return 'action';
  if (['boss_ra_atk_1','boss_ra_atk_1_wait','boss_ra_punch','boss_ra_punch_out','double'].includes(type)) return 'road';
  if (isCurve({type})) return type.includes('red') ? 'road' : 'air';
  return target === 'air' ? 'air' : 'road';
}

export function directions(type) {
  if (type === 'assault') return ['up'];
  if (type === 'hammer') return ['down'];
  if (type === 'punch') return ['normal','down'];
  if (['small_1','mid_1','mid_2'].includes(type)) return ['normal','up','down'];
  return ['normal'];
}

export function makeNote(type, time, lane, layer=0, changes={}) {
  const track = trackFor(type, lane);
  const note = {
    id: uid(), type, time: round(time), track, layer,
    end: round(time + defaultLength(type)), direction: directions(type)[0], speed: 2, heart: false,
    value: ['effect_timing','effect_scene_timing','bms_spdctrl','vfx_bgluminance'].includes(type) ? 1
      : type === 'vfx_changescene' ? 'scene_factory' : ['vfx_visibility','vfx_bossvisibility'].includes(type) ? true : 0,
    easing: 'NULL', ...changes,
  };
  if (isCurve(note) && !note.nodes) {
    const position = track === 'air' ? 1 : 0;
    note.nodes = [{ time:note.time, position, curve:'Linear' }, { time:note.end, position, curve:'Linear' }];
  }
  return note;
}

export function makeProject(changes={}) {
  const id = uid();
  return {
    id, name:'未命名谱面', artist:'', designer:'', difficulty:'master', level:'8', bpm:128,
    numerator:4, denominator:4, duration:60, previewStart:0, previewEnd:0,
    scene:'scene_factory', format:'mdcpmf', audioName:'music.ogg', offset:0,
    layers:[{id:0,name:'主谱面',visible:true}], notes:[], tempos:[], axes:[], ...changes,
  };
}

export function demoProject() {
  const project = makeProject({name:'Neon Afterglow',artist:'Studio demo',designer:'Chart Studio',level:'8',duration:90,bpm:128,demo:true,previewEnd:15});
  const step = 60 / project.bpm / 2;
  const pattern = [
    [1,'road','small_1'],[3,'air','small_1'],[5,'road','mid_1'],[6,'road','small_1'],[7,'air','special_note'],
    [8,'air','long',3],[9,'road','small_1'],[12,'road','gear'],[13,'air','mid_1'],[15,'road','small_1'],
    [16,'air','small_1'],[17,'air','small_1'],[19,'road','mid_2'],[20,'air','small_1'],[21,'road','long',4],
    [22,'air','mid_1'],[26,'road','small_1'],[28,'air','gear'],[29,'road','small_1'],[31,'air','small_1'],
  ];
  for (let block=0;block<12;block++) {
    for (const [slot,track,type,length] of pattern) {
      const time = (block*32+slot)*step;
      if (time >= 90) continue;
      project.notes.push(makeNote(type,time,track,0,length ? {end:round(time+length*step)} : {}));
    }
  }
  return project;
}

export function normalizeProject(input) {
  const project = makeProject(input);
  if (typeof project.name !== 'string' || !Array.isArray(project.notes) || !Array.isArray(project.layers) || !Array.isArray(project.tempos) || !Array.isArray(project.axes)) {
    throw new Error('项目数据格式无效');
  }
  if (!project.layers.length) project.layers = [{id:0,name:'主谱面',visible:true}];
  project.bpm = clamp(num(project.bpm, 128), 1, 9999);
  project.duration = clamp(num(project.duration,60), 1, 86400);
  project.numerator = clamp(Math.round(num(project.numerator,4)),1,64);
  project.denominator = clamp(Math.round(num(project.denominator,4)),1,64);
  project.offset = clamp(num(project.offset),-86400,86400);
  project.tempos = project.tempos.filter(item=>item && num(item.time)>0 && num(item.bpm)>0).map(item=>({
    ...item,id:item.id || uid(),time:num(item.time),bpm:clamp(num(item.bpm),1,9999),
    numerator:clamp(Math.round(num(item.numerator,4)),1,64),denominator:clamp(Math.round(num(item.denominator,4)),1,64),
  }));
  project.notes = project.notes.filter(Boolean).map(note=>makeNote(String(note.type || 'unknown'),num(note.time),note.track,num(note.layer),{
    ...note,id:note.id || uid(),time:num(note.time),end:num(note.end,num(note.time)),layer:num(note.layer),
    ...(Array.isArray(note.nodes) ? {nodes:note.nodes.filter(Boolean).map(node=>({...node,time:num(node.time),position:num(node.position)})).sort((a,b)=>a.time-b.time)}:{})
  }));
  return project;
}

export function timingSections(project) {
  const sections = [{time:project.offset || 0,bpm:project.bpm,numerator:project.numerator,denominator:project.denominator,measure:1}];
  for (const change of [...project.tempos].sort((a,b) => a.time-b.time)) {
    const previous = sections.at(-1);
    if (change.time < previous.time) continue;
    const length = previous.numerator*60/previous.bpm*4/previous.denominator;
    sections.push({...previous,...change,measure:previous.measure+Math.ceil((change.time-previous.time)/length-1e-7)});
  }
  return sections;
}

export function gridPoints(project, start, end, division, minimumStep=0) {
  const sections = timingSections(project);
  const points = [];
  for (let i=0;i<sections.length;i++) {
    const {time,bpm,numerator,denominator,measure} = sections[i];
    const stop = Math.min(end,sections[i+1] ? sections[i+1].time-1e-8 : Infinity);
    if (stop < start || time > stop) continue;
    const beat = 60/bpm*4/denominator;
    const subdivisions = Math.max(1, Math.round(division*4/denominator));
    const step = beat/subdivisions;
    const barSteps = numerator*subdivisions;
    let stride = step < minimumStep ? subdivisions : 1;
    if (stride*step < minimumStep) stride = barSteps;
    if (stride*step < minimumStep) stride *= Math.ceil(minimumStep/(stride*step));
    const first = Math.ceil(Math.max(i ? 0 : -Infinity,(start-time)/step-1e-8)/stride)*stride;
    for (let j=first;j<=(stop-time)/step+1e-8;j+=stride) {
      const kind = j % barSteps === 0 ? 'bar' : j % subdivisions === 0 ? 'beat' : 'sub';
      points.push({time:round(time+j*step),kind,measure:measure+Math.floor(j/barSteps)});
    }
  }
  return points;
}

export function snapTime(project,time,division) {
  const sections = timingSections(project);
  const index = sections.findLastIndex(section => section.time <= time);
  const section = sections[Math.max(0,index)];
  const beat = 60/section.bpm*4/section.denominator;
  const step = beat/Math.max(1,Math.round(division*4/section.denominator));
  const snapped = section.time + Math.round((time-section.time)/step)*step;
  const next = sections[index+1]?.time ?? Infinity;
  return round(clamp(Math.min(snapped,next),0,project.duration));
}

export function moveNote(note, delta, stage=0) {
  note.time = round(note.time+delta);
  note.end = round(note.end+delta);
  if (note.nodes) {
    for (const node of note.nodes) {
      node.time=round(node.time+delta);
      node.position=round(clamp(node.position+stage,-1,2));
    }
  }
}

export function mirrorNote(note, withDirection=true) {
  if (isCurve(note)) {
    note.type = note.type.replace(/red|blue/,color => color==='red' ? 'blue' : 'red');
    for (const node of note.nodes || []) node.position=round(1-node.position);
  }
  if (playable(note)) note.track=trackFor(note.type,note.track==='air'?'road':'air');
  const reversed = {up:'down',down:'up'}[note.direction];
  if (withDirection && directions(note.type).includes(reversed)) note.direction=reversed;
}

export function editNoteType(note, type) {
  note.type=type;
  note.track=trackFor(type,note.track);
  if (!directions(type).includes(note.direction)) note.direction=directions(type)[0];
  if (!heartTypes.includes(type)) note.heart=false;
  if (!isHold(type)) note.end=note.time;
  else if (note.end<=note.time) note.end=round(note.time+defaultLength(type));
  if (isCurve(note) && !note.nodes) note.nodes=makeNote(type,note.time,note.track,0,{end:note.end}).nodes;
  if (!isCurve(note)) delete note.nodes;
}

export function designCheck(project) {
  const findings = [];
  const notes = [...project.notes].sort((a,b)=>a.time-b.time);
  const lanes = new Map();
  const doubles = new Set(notes.filter(note=>note.type==='double').map(note=>note.layer+':'+note.time));
  let bossOpen = false;
  for (const note of notes) {
    const add = (code,other) => findings.push({code,time:note.time,note,other});
    if (note.time<0 || note.time>project.duration || isHold(note.type) && note.end>project.duration) add('range');
    if (!Object.hasOwn(noteNames.en_us,note.type) && !['bms_spdctrl','bms_aux'].includes(note.type)) add('unknown');
    if (note.type==='boss_ra') bossOpen=true;
    if (note.type==='boss_ra_out') bossOpen=false;
    if (note.type.startsWith('boss_ra_') && note.type!=='boss_ra_out' && !bossOpen) add('bossRange');
    if (!playable(note)) continue;
    const lane = `${note.layer}:${note.track}`;
    const previous = lanes.get(lane);
    if (previous && (previous.time===note.time || isHold(previous.type) && previous.end>note.time)) add('overlap',previous);
    if (!previous || previous.end <= note.end) lanes.set(lane,note);
    if (note.type==='gear' && doubles.has(note.layer+':'+note.time)) add('doubleGear');
  }
  if (bossOpen) findings.push({code:'bossOpen',time:notes.at(-1)?.time || 0});
  return findings;
}
