import './style.css';
import { icon } from './icons.js';
import { shell,renderTop,renderSidebar,renderHeader,renderToolbar,renderTransport,renderAudioLevels,muteLabel,renderPalette,renderBoard,renderInspector,button,iconButton,html,input,select,field,checkbox,active,stageNames,stages } from './view.js';
import { Timeline, timecode } from './timeline.js';
import { Transport,makeDemoAudio,estimateBpm,encodeOgg } from './audio.js';
import { readWorkspace,saveWorkspace } from './storage.js';
import { Playtest } from './playtest.js';
import { openFiles,exportFile,formatLoss,makePng } from './formats.js';
import { uid,clone,round,clamp,num,makeProject,demoProject,normalizeProject,makeNote,groups,groupOf,tracks,scenes,difficulties,curves,playable,directions,isCurve,isHold,isAxis,isGlobalAxis,snapTime,moveNote,mirrorNote,editNoteType,designCheck,trackFor,defaultLength,noteTypeNames,gridPoints } from './model.js';
import { heartTypes } from './definitions.js';

const $=id=>document.getElementById(id);
$('app').innerHTML=shell();
const dlg=$('dialog');
const defaults={
  lang:'zh_cn',division:4,curveDivision:12,snap:true,strict:true,grid:true,waveform:true,indicator:true,follow:true,mirrorDirection:true,
  metronome:false,noteClick:false,autosave:true,filterEnabled:true,visibleLayers:false,layerOpacity:.35,otherOpacity:1,rate:1,volume:.8,lastVolume:.8,waveformGain:1,
  defaultAxis:'vfx_changescene',fps:60,vsync:true,clipOffset:0,multi:false,slideFill:false,submode:'object',
};
const settingsKey='muse-studio-settings-v1';
let persisted={};
try {persisted=JSON.parse(localStorage.getItem(settingsKey) || '{}') || {};} catch {}
const s={
  ...defaults,...persisted, mode:'select',noteType:'small_1',category:'normal',layer:0,board:false,mobile:'editor',saved:true,audioLevels:false,
  hiddenTracks:new Set(persisted.hiddenTracks),hiddenTypes:new Set(persisted.hiddenTypes),hiddenGroups:new Set(persisted.hiddenGroups),
  selectionTypes:new Set(persisted.selectionTypes),selected:new Set(),selectedNode:null,curveDraft:null,curveType:'Linear',
  loopEnabled:false,loopStart:0,loopEnd:15,clipboard:[],placementDirection:'normal',placementSpeed:2,
};
const t=(zh,en=zh,ja=en)=>s.lang==='zh_cn'?zh:s.lang==='ja_jp'?ja:en;
const nLabel=type=>noteTypeNames(type,s.lang);
const difficultyNames=()=>[t('萌新','Easy','Easy'),t('高手','Hard','Hard'),t('大触','Master','Master'),t('里谱','Remaster','Remaster'),t('特殊','Special','Special'),t('色谱','Color','Color')];
const groupLabels=()=>[t('常规','Notes','ノーツ'),t('动作','Actions','アクション'),t('特效','Effects','エフェクト'),t('节拍','Tempo','テンポ'),'MDCP','BMS'];
let documents=[demoProject()];
const initialDemoId=documents[0].id;
let p=documents[0];
let assets={extras:{}};
let coverUrl='';
let audioGeneration=0;
let undo=[];
let redo=[];
let saveTimer;
let toastTimer;
let lastFrame=0;
let lastTick=0;
let saving=0;
let busy=false;
let formHandler;
let filterList='';
const decodedFiles=new WeakMap();
const bpmRequests=new WeakMap();
const transport=new Transport(()=>updatePlayControls());
const preview=new Playtest($('preview'),transport,()=>p,t,icon,()=>{updatePlayControls();timeline.draw();});
const timeline=new Timeline($('canvas-wrap'),$('lane-labels'),$('scrub'),{
  state:s,t,project:()=>p,visibleNotes,selectable,select:selectOne,selectMany,selectedOriginals:()=>clone(selectedItems()),
  snapshot:()=>clone(p),restore,finishDrag,dragSelection,remove,insert,curvePoint,finishCurve,seek,snap,updateZoom,
  currentTime:()=>transport.time(),peaks:()=>transport.peaks,audioDuration:()=>transport.buffer?.duration || p.duration,
});
applyPreferences();
render();
initialize();

async function initialize() {
  try {
    const stored=await readWorkspace();
    if (stored?.documents?.length) {
      documents=stored.documents.map(normalizeProject);
      p=documents.find(chart=>chart.id===stored.active) || documents[0];
      assets=stored.assets || {extras:{}};
    }
  } catch {
    showToast(t('无法恢复上次的本地项目','Could not restore the local project','前回のプロジェクトを復元できません'),true);
  }
  await resetEditor();
  requestAnimationFrame(frame);
}

function applyPreferences() {
  document.documentElement.lang=({zh_cn:'zh-CN',en_us:'en',ja_jp:'ja'})[s.lang] || 'zh-CN';
  s.volume=clamp(num(s.volume,.8),0,1);
  s.lastVolume=s.volume || clamp(num(s.lastVolume,.8),.01,1);
  s.waveformGain=clamp(num(s.waveformGain,1),.25,4);
  transport.setRate(s.rate);
  transport.setVolume(s.volume);
}
function storePreferences() {
  const options=Object.fromEntries(Object.keys(defaults).map(key=>[key,s[key]]));
  for (const key of ['hiddenTracks','hiddenTypes','hiddenGroups','selectionTypes']) options[key]=[...s[key]];
  options.bindings=s.bindings || {};
  try {localStorage.setItem(settingsKey,JSON.stringify(options));} catch {}
}
function render() {
  $('top').innerHTML=renderTop(t,s);
  $('sidebar').innerHTML=renderSidebar(t,s,p,coverUrl);
  $('project-head').innerHTML=renderHeader(t,s,p);
  renderTools();
  if(s.audioLevels) $('audio-levels').innerHTML=renderAudioLevels(t,s);
  renderPaletteOnly();
  updateInspector();
  renderStatus();
  $('timeline-canvas').setAttribute('aria-label',t('谱面时间轴','Chart timeline','譜面タイムライン'));
  $('scrub').setAttribute('aria-label',t('移动时间轴视野','Scroll timeline','タイムラインを移動'));
  $('mobile-nav').setAttribute('aria-label',t('工作区视图','Workspace view','ワークスペース'));
  setMobile(s.mobile,false);
  timeline.layout();
  timeline.draw();
}
function renderTools() {
  $('toolbar').innerHTML=renderToolbar(t,s);
  $('toolbar').querySelector('[data-action=undo]').disabled=!undo.length&&!s.curveDraft;
  $('toolbar').querySelector('[data-action=redo]').disabled=!redo.length;
  $('canvas-wrap').dataset.mode=s.mode;
  $('board-head').hidden=!s.board;
  $('board-head').innerHTML=s.board ? renderBoard(t,s) : '';
  updatePlayControls();
}
function updatePlayControls() {
  $('transport').innerHTML=renderTransport(t,s,transport.time(),p.duration,transport.playing);
  const levels=$('transport').querySelector('[data-action=audio-levels]');
  levels.setAttribute('aria-controls','audio-levels');
  levels.setAttribute('aria-expanded',String(s.audioLevels));
  updateZoom();
}
function toggleAudioLevels() {
  s.audioLevels=!s.audioLevels;
  const panel=$('audio-levels');
  panel.hidden=!s.audioLevels;
  if(s.audioLevels) panel.innerHTML=renderAudioLevels(t,s);
  for(const control of document.querySelectorAll('[data-action=audio-levels]')) {
    control.setAttribute('aria-expanded',String(s.audioLevels));
    if(control.classList.contains('level-toggle')) control.classList.toggle('active',s.audioLevels);
  }
}
function setAudioLevel(name,value) {
  if(name==='volume') {
    s.volume=clamp(value,0,1);
    if(s.volume) s.lastVolume=s.volume;
    transport.setVolume(s.volume);
    const mute=$('transport').querySelector('[data-action=mute]');
    mute.title=muteLabel(t,s);
    mute.setAttribute('aria-label',mute.title);
    mute.classList.toggle('active',!s.volume);
  } else {
    s.waveformGain=clamp(value,.25,4);
    timeline.draw();
  }
  const percent=Math.round(s[name]*100)+'%';
  for(const control of document.querySelectorAll(`input[name="${name}"]`)) {
    if(Number(control.value)!==s[name]) control.value=s[name];
    control.setAttribute('aria-valuetext',percent);
  }
  for(const output of document.querySelectorAll(`[data-level-value="${name}"]`)) output.value=percent;
  storePreferences();
}
function updateZoom() {
  const label=$('zoom-val');
  if(label) label.textContent=Math.round(timeline.scale/104*100)+'%';
}
function renderPaletteOnly() {
  $('palette').innerHTML=renderPalette(t,s);
  $('editor-hint').innerHTML=s.curveDraft ?
    `<span class="curve-banner">${t('点击轨道添加曲线节点','Tap the lanes to add curve nodes','レーンをタップしてノードを追加')} · ${html(s.curveType)}
      ${button('curve-finish',t('完成','Finish','完了'),'check','small bordered')}${button('curve-cancel',t('取消','Cancel','キャンセル'),'close','small')}</span>` :
    `${icon('help',14)}<span>${s.mode==='draw'?t('点击轨道放置音符，拖动绘制长音。','Tap a lane to add a note. Drag to draw a hold.','タップでノーツ、ドラッグで長押しを配置。'):s.mode==='pan'?t('拖动时间轴移动视野，双指缩放。','Drag to scroll. Pinch to zoom.','ドラッグで移動、ピンチで拡大。'):s.mode==='erase'?t('点选音符即可擦除。','Tap an object to erase it.','タップしたノーツを削除します。'):t('拖动框选音符。滚动时间轴或双指缩放。','Drag to box-select. Scroll or pinch to move around.','ドラッグで範囲選択。スクロール・ピンチで移動します。')}</span>`;
}
function renderStatus() {
  $('statusbar').innerHTML=`<span><i class="dot"></i>${t('本地工作区','Local workspace','ローカルワークスペース')}</span><span>CustomPlay · BMS · MDM · Euterpe</span>`;
}
function updateInspector() {
  $('inspector').innerHTML=renderInspector(t,s,p,selectedItems(),assets.audio?.name || (p.demo?'Neon Afterglow · demo':''),assets.cover?.name);
}
function updateSelection() {updateInspector();timeline.draw();}
function setMobile(target,draw=true) {
  s.mobile=target;
  $('workspace').dataset.mobile=target;
  $('mobile-nav').innerHTML=[
    ['editor',t('编辑','Timeline','編集'),'grid'],
    ['inspection',t('属性','Inspector','プロパティ'),'sliders'],
    ['project',t('项目','Project','プロジェクト'),'folder'],
  ].map(([id,label,shape])=>button('mobile',label,shape,active(s.mobile===id),id)).join('');
  if(draw) {timeline.layout();timeline.draw();}
}
function selectedItems() {
  return [...p.notes,...p.tempos.map(tempo=>({...tempo,type:'preset_beatbpm',end:tempo.time,track:'tempo'}))].filter(item=>s.selected.has(item.id));
}
function visibleNotes() {
  const layers=new Set(p.layers.filter(layer=>layer.visible).map(layer=>layer.id));
  return p.notes.filter(note=>(note.layer===-1 || layers.has(note.layer)) && (!s.filterEnabled || !s.hiddenGroups.has(groupOf(note.type)) && !s.hiddenTypes.has(note.type)));
}
function selectable(note) {
  return !s.selectionTypes.has(groupOf(note.type)) && (note.layer===undefined || note.layer===-1 || s.visibleLayers || note.layer===s.layer);
}
function selectMany(ids,add=false) {
  s.selected = new Set(add?[...s.selected,...ids]:ids);
  s.selectedNode=null;
  s.selectedSegment=null;
  updateSelection();
}
function selectOne(id,add,hit) {
  if(add && s.selected.has(id)) s.selected.delete(id);
  else if(add) s.selected.add(id);
  else if(!s.selected.has(id)) s.selected=new Set([id]);
  s.selectedNode=hit?.node!==undefined && s.submode==='node'?{id,index:hit.node}:null;
  s.selectedSegment=hit?.segment && s.submode==='segment'?{id,index:hit.segment}:null;
  updateSelection();
}

function restore(project,refresh=false) {
  const index=documents.findIndex(chart=>chart.id===project.id);
  if(index>=0) documents[index]=project;
  p=project;
  transport.duration=p.duration;
  if(!p.layers.some(layer=>layer.id===s.layer)) s.layer=p.layers[0].id;
  if(refresh) render();
}
function record(snapshot) {
  undo.push(snapshot);
  if(undo.length>100) undo.shift();
  redo=[];
}
function change(mutator) {
  const before=clone(p);
  mutator(p);
  if(JSON.stringify(before)===JSON.stringify(p)) return;
  record(before);
  changed();
}
function changed() {
  transport.duration=p.duration;
  render();
  queueSave();
}
function undoRedo(redoing=false) {
  if(s.curveDraft && !redoing) {
    if(s.curveDraft.nodes.length<=1) s.curveDraft=null;
    else s.curveDraft.nodes.pop();
    render();return;
  }
  const from=redoing?redo:undo;
  const to=redoing?undo:redo;
  const snapshot=from.pop();
  if(!snapshot) return;
  to.push(clone(p));restore(snapshot);changed();
}
function queueSave() {
  s.saved=false;
  if(!s.autosave) {
    setSaveLabel(t('未保存','Unsaved','未保存'));
    return;
  }
  setSaveLabel(t('正在保存','Saving','保存中'));
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>save(),300);
}
function setSaveLabel(message) {
  const el=$('save-state');
  if(el) el.innerHTML=`${icon(s.saved?'check':'clock',14)} ${html(message)}`;
}
async function save(notify=false) {
  const ticket=++saving;
  clearTimeout(saveTimer);
  try {
    await saveWorkspace({documents:clone(documents),active:p.id,assets});
    if(ticket!==saving) return;
    s.saved=true;
    setSaveLabel(t('已保存到此设备','Saved on this device','端末に保存済み'));
    if(notify) showToast(t('已保存到此设备','Saved on this device','端末に保存済み'));
  } catch {
    s.saved=false;
    setSaveLabel(t('本地保存失败','Local save failed','ローカル保存に失敗'));
    showToast(t('此设备无法保存项目，请导出备份。','Local save failed. Export a backup.','保存できません。バックアップを書き出してください。'),true);
  }
}

function snap(time) {
  return s.snap ? snapTime(p,time,s.division) : round(clamp(time,0,p.duration));
}
function seek(time,center=false) {
  transport.seek(clamp(time,0,p.duration));
  lastTick=transport.time();
  if(center) timeline.center(transport.time());
  updateClock();
  timeline.draw();
}
function updateClock() {
  const clock=$('clock');
  if(clock) clock.innerHTML=`${timecode(transport.time())}<small>/ ${timecode(p.duration,0)}</small>`;
}
function frame(now) {
  const wait=s.vsync?0:1000/s.fps;
  if(now-lastFrame>=wait && (transport.playing || preview.open)) {
    const wasPlaying=transport.playing;
    const time=transport.tick(s.loopEnabled?{start:s.loopStart,end:s.loopEnd}:null);
    if(wasPlaying && time>=lastTick) {
      if(s.metronome) for(const point of gridPoints(p,lastTick+.001,time,1)) transport.click(point.kind==='bar'?1020:690,point.kind==='bar');
      if(s.noteClick && visibleNotes().some(note=>playable(note) && note.time>lastTick && note.time<=time)) transport.click(490);
    }
    if(s.follow && (timeline.x(time)>timeline.width*.78 || timeline.x(time)<0)) timeline.center(time,.25);
    lastTick=time;
    updateClock();
    timeline.draw();
    if(preview.open) preview.draw(time);
    lastFrame=now;
  }
  requestAnimationFrame(frame);
}
async function play() {
  if(transport.playing) transport.pause();
  else {
    lastTick=transport.time();
    await transport.play();
  }
  updatePlayControls();
  if(preview.open) preview.updateButton();
}
function setMode(mode) {
  if(s.curveDraft && mode!=='draw') finishCurve();
  s.mode=mode;renderTools();renderPaletteOnly();timeline.draw();
}
function addTempo(time) {
  if(p.tempos.some(tempo=>tempo.time===time)) return showToast(t('该位置已有节拍点','A tempo marker already exists here','この位置にはテンポ点があります'),true);
  if(time<=0) return showToast(t('节拍点须放在正时间','Tempo markers need a positive time','テンポ点は正の時間に置きます'),true);
  tempoDialog({id:uid(),time,bpm:p.bpm,numerator:p.numerator,denominator:p.denominator},true);
}
function insert(row,time,end=null) {
  if(row==='tempo' || s.noteType==='preset_beatbpm') return addTempo(time);
  const axis=row.startsWith('axis:') && p.axes.find(axis=>axis.id===row.slice(5));
  let type=axis?.type || s.noteType;
  if(row==='effect' && !groups.effect.includes(type) && !groups.bms.includes(type)) type=s.defaultAxis;
  if(row==='action' && groupOf(type)!=='action') type='boss_ra';
  const layerForAxis=isGlobalAxis(type)?-1:s.layer;
  const link=axis || (isAxis(type) ? p.axes.find(item=>item.type===type && item.layer===layerForAxis) : null);
  const lane=['air','road'].includes(row)?row:trackFor(type);
  if(s.snap&&s.strict && playable({track:trackFor(type,lane)}) && p.notes.some(note=>note.layer===s.layer&&note.time===time&&note.track===trackFor(type,lane))) {
    return showToast(t('该格线位置已有音符','This grid slot already has a note','この位置にはノーツがあります'),true);
  }
  if(link && p.notes.some(note=>note.axisId===link.id&&note.time===time)) return showToast(t('该位置已有关键帧','A keyframe already exists here','この位置にはキーフレームがあります'),true);
  const note=makeNote(type,end!==null?Math.min(time,end):time,lane,link?.layer??(isAxis(type)?layerForAxis:s.layer),{
    direction:directions(type).includes(s.placementDirection)?s.placementDirection:directions(type)[0],speed:s.placementSpeed,
  });
  if(end!==null && end!==time && type!=='long_short') note.end=Math.max(time,end);
  if(isHold(type)) note.end=Math.min(p.duration,note.end);
  if(link) note.axisId=link.id;
  if(s.slideFill && playable(note)&&!isHold(type) && end!==null && end!==time) {
    const points=gridPoints(p,Math.min(time,end),Math.max(time,end),s.division).slice(0,1000);
    const notes=points.filter(point=>!p.notes.some(other=>other.layer===s.layer && other.track===note.track && other.time===point.time))
      .map(({time})=>({...note,id:uid(),time,end:time}));
    s.selected=new Set(notes.map(item=>item.id));change(chart=>chart.notes.push(...notes));return;
  }
  s.selected=new Set([note.id]);
  change(chart=>{
    if(isAxis(type) && !link) {
      const newAxis={id:uid(),type,layer:layerForAxis};
      chart.axes.push(newAxis);
      note.axisId=newAxis.id;
    }
    chart.notes.push(note);
  });
}
function remove(ids) {
  const removeSet=new Set(ids);
  s.selected=new Set([...s.selected].filter(id=>!removeSet.has(id)));
  s.selectedNode=null;
  change(chart=>{
    chart.notes=chart.notes.filter(note=>!removeSet.has(note.id));
    chart.tempos=chart.tempos.filter(tempo=>!removeSet.has(tempo.id));
  });
}
function curvePoint(time,position,hit,extend,insertPoint) {
  const existing=hit && p.notes.find(note=>note.id===hit.id && isCurve(note));
  if(existing && insertPoint) {
    if(time<=existing.time || time>=existing.end || existing.nodes.some(node=>node.time===time)) return;
    selectMany([existing.id]);
    change(()=>{existing.nodes.push({time,position,curve:s.curveType});existing.nodes.sort((a,b)=>a.time-b.time);});
    return;
  }
  if(!s.curveDraft && existing && extend) {
    s.curveDraft=clone(existing);s.curveDraft.replace=true;
  }
  if(!s.curveDraft) {
    s.curveDraft=makeNote(s.noteType,time,'road',s.layer,{nodes:[{time,position,curve:s.curveType}]});
  } else {
    if(time<=s.curveDraft.nodes.at(-1).time) return showToast(t('下一个节点须在前一个节点之后','The next node must be later','次のノードは後ろに置きます'),true);
    s.curveDraft.nodes.push({time,position,curve:s.curveType});
    s.curveDraft.end=time;
  }
  renderTools();renderPaletteOnly();timeline.draw();
}
function finishCurve() {
  const draft=s.curveDraft;
  s.curveDraft=null;
  if(!draft || draft.nodes.length<2) {renderTools();renderPaletteOnly();return;}
  const {replace,...note}=draft;
  note.time=note.nodes[0].time;note.end=note.nodes.at(-1).time;
  s.selected=new Set([note.id]);
  change(chart=>{
    if(replace) chart.notes[chart.notes.findIndex(item=>item.id===note.id)]=note;
    else chart.notes.push(note);
  });
}
function curveNode(index,kind,value) {
  const note=p.notes.find(note=>s.selected.has(note.id)&&isCurve(note));
  if(!note || !note.nodes[index]) return;
  const position=note.nodes[index];
  if(kind==='time' && (value<0 || value>p.duration || index>0 && value<=note.nodes[index-1].time || index<note.nodes.length-1 && value>=note.nodes[index+1].time)) {
    updateInspector();
    return showToast(t('节点时间须在相邻节点之间','Node time must stay between its neighbors','ノード時間を隣接するノードの間に設定してください'),true);
  }
  change(()=>{
    position[kind]=value;
    note.time=note.nodes[0].time;
    note.end=note.nodes.at(-1).time;
  });
}

function dragSelection(drag,delta,position,curvePosition) {
  const originals=drag.items;
  const until=p.duration;
  if(drag.hit.node!==undefined && s.submode==='node' && originals.length===1) {
    const orig=originals[0];
    const note=p.notes.find(note=>note.id===orig.id);
    const i=drag.hit.node;
    const low=i>0?orig.nodes[i-1].time+.0001:0;
    const high=i<orig.nodes.length-1?orig.nodes[i+1].time-.0001:until;
    const {nodes}=note;
    nodes[i]={...orig.nodes[i],time:round(clamp(orig.nodes[i].time+delta,low,high)),position:curvePosition};
    note.time=nodes[0].time;note.end=nodes.at(-1).time;
    return;
  }
  if(drag.hit.handle && originals.length===1) {
    const orig=originals[0];
    const note=p.notes.find(note=>note.id===orig.id);
    note.end=round(clamp(orig.end+delta,note.time+.001,until));return;
  }
  delta=clamp(delta,-Math.min(...originals.map(note=>note.time)),until-Math.max(...originals.map(note=>note.end)));
  for(const original of originals) {
    const index=p.notes.findIndex(note=>note.id===original.id);
    if(index<0) {
      const marker=p.tempos.find(tempo=>tempo.id===original.id);
      if(marker && !p.tempos.some(x=>x.id!==marker.id&&x.time===round(original.time+delta))) marker.time=Math.max(.0001,round(original.time+delta));
      continue;
    }
    const note=clone(original);
    const stage=isCurve(note) ? timeline.curvePosition(position.y)-timeline.curvePosition(drag.y) : 0;
    moveNote(note,delta,stage);
    if(originals.length===1 && playable(note) && !isCurve(note) && ['air','road'].includes(position.row?.id)) note.track=trackFor(note.type,position.row.id);
    p.notes[index]=note;
  }
}
function finishDrag(snapshot) {
  if(JSON.stringify(snapshot)!==JSON.stringify(p)) {record(snapshot);changed();}
}
function copy(toLayer=false) {
  const items=selectedItems();
  if(!items.length) return;
  s.clipboard=clone(items);
  s.clipboard.forEach(item=>{if(toLayer && item.layer!==undefined && item.layer!==-1) {item.layer=s.layer;delete item.axisId;}});
  updateInspector();
  showToast(t('已复制。把播放头移到目标位置后粘贴。','Copied. Move the playhead and paste.','コピーしました。再生ヘッドを移動して貼り付けます。'));
}
function paste() {
  if(!s.clipboard.length) return;
  const base=Math.min(...s.clipboard.map(note=>note.time));
  const end=Math.max(...s.clipboard.map(note=>note.end));
  if(end-base>p.duration) return showToast(t('选区超出编辑长度','Selection is longer than the chart','選択範囲が譜面より長すぎます'),true);
  const offset=clamp(snap(transport.time())-base,-base,p.duration-end);
  const items=clone(s.clipboard);
  s.selected=new Set(items.map(note=>(note.id=uid())));
  change(chart=>{
    for(const note of items) {
      moveNote(note,offset);
      if(note.type==='preset_beatbpm') {
        if(note.time>0 && !chart.tempos.some(tempo=>tempo.time===note.time)) chart.tempos.push(note);
      } else {
        if(!chart.layers.some(layer=>layer.id===note.layer)&&note.layer!==-1) note.layer=s.layer;
        if(!chart.axes.some(axis=>axis.id===note.axisId)) delete note.axisId;
        if(isAxis(note.type)&&!note.axisId) {
          let axis=chart.axes.find(axis=>axis.layer===note.layer&&axis.type===note.type);
          if(!axis) {axis={id:uid(),type:note.type,layer:note.layer};chart.axes.push(axis);}
          note.axisId=axis.id;
        }
        chart.notes.push(note);
      }
    }
  });
}
function editInspector(name,value) {
  if(name==='baseColor' && value && !/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value)) {
    updateInspector();
    return showToast(t('请输入 #RRGGBB 或 #RRGGBBAA','Use #RRGGBB or #RRGGBBAA','色は #RRGGBB または #RRGGBBAA で入力してください'),true);
  }
  if(['hsv','gradientStart','gradient'].includes(name) && value) {
    const values=value.split('^').map(token=>Number(token.trim()));
    const gradient=name!=='hsv';
    if(values.length!==(gradient?4:3) || values.some(number=>!Number.isFinite(number)) || gradient && (values[3]<0 || values[3]>1)) {
      updateInspector();
      const message=gradient
        ? t('请输入以 ^ 分隔的四个参数，不透明度范围为 0 到 1。','Enter four values separated by ^. Alpha must be between 0 and 1.','^ で区切った四つの値を入力してください。不透明度は 0 から 1 です。')
        : t('请输入以 ^ 分隔的色相、饱和度和明度。','Separate hue, saturation and value with ^.','色相・彩度・明度を ^ で区切ってください。');
      return showToast(message,true);
    }
  }
  const selected=selectedItems();
  if(!selected.length) return;
  change(chart=>{
    for(const item of selected) {
      const tempo=chart.tempos.find(tempo=>tempo.id===item.id);
      if(tempo) {
        if(name==='time' && value>0 && value<=p.duration && !chart.tempos.some(other=>other.id!==tempo.id&&other.time===value)) tempo.time=value;
        else if(name==='bpm') tempo.bpm=clamp(value,1,9999);
        else if(name==='numerator') tempo.numerator=clamp(Math.round(value),1,64);
        else if(name==='denominator') tempo.denominator=value;
        continue;
      }
      const note=chart.notes.find(note=>note.id===item.id);
      if(name==='type') {
        editNoteType(note,value);
        if (isAxis(value)) {
          note.layer=isGlobalAxis(value)?-1:note.layer===-1?s.layer:note.layer;
          let axis=chart.axes.find(axis=>axis.type===value&&axis.layer===note.layer);
          if(!axis) {axis={id:uid(),type:value,layer:note.layer};chart.axes.push(axis);}
          note.axisId=axis.id;
          note.value=makeNote(value,note.time,note.track,note.layer).value;
        } else delete note.axisId;
      } else if(name==='time') moveNote(note,clamp(value-note.time,-note.time,p.duration-note.end));
      else if(name==='end' && value>=note.time && value<=p.duration) {
        if(isCurve(note)&&value>note.nodes.at(-2).time) note.nodes.at(-1).time=value;
        if(!isCurve(note)||value>note.nodes.at(-2).time) note.end=value;
      } else if(name==='track') note.track=trackFor(note.type,value);
      else if(name==='layer' && !isGlobalAxis(note.type)) {
        note.layer=value;
        if(note.axisId) {
          let axis=chart.axes.find(axis=>axis.type===note.type&&axis.layer===value);
          if(!axis) {axis={id:uid(),type:note.type,layer:value};chart.axes.push(axis);}
          note.axisId=axis.id;
        }
      } else if(name==='direction') {if(directions(note.type).includes(value)) note.direction=value;}
      else if(name==='speed') note.speed=value;
      else if(name==='heart') {if(heartTypes.includes(note.type)) note.heart=value;}
      else if(name==='value' && ['vfx_visibility','vfx_bossvisibility'].includes(note.type)) note.value=value==='true';
      else if(['value','easing','baseColor','hsv','gradientStart','gradient','stayTexture'].includes(name)) note[name]=value;
    }
  });
  updateInspector();
}

function showToast(message,error=false) {
  const box=$('toast');
  box.textContent=message;
  box.classList.toggle('error',error);
  box.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>box.hidden=true,error?5800:3300);
}
function dialog(title,body,submitLabel,handler) {
  formHandler=handler;
  dlg.innerHTML=`<form id="dialog-form">
    <header class="dialog-head"><h2>${html(title)}</h2>${iconButton('close-dialog',t('关闭','Close','閉じる'),'close')}</header>
    <div class="dialog-body">${body}</div>
    ${submitLabel?`<footer class="dialog-actions">${button('close-dialog',t('取消','Cancel','キャンセル'),null,'bordered')}<button class="primary" type="submit">${html(submitLabel)}</button></footer>`:''}</form>`;
  if(!dlg.open) dlg.showModal();
}
function choices(items) {
  return items.map(([action,label,detail,shape,value=''])=>`<button type="button" class="choice" data-action="${action}" data-value="${html(value)}">${icon(shape,20)}<span><strong>${html(label)}</strong><small>${html(detail)}</small></span></button>`).join('');
}

const formats=[
  ['mdcpmf', 'MDCP 数据', 'score.mdcpmf'],
  ['mdcp-zip', 'MDCP 谱面包', 'score.mdcpmf + music.ogg'],
  ['bms','BMS 谱面','.bms'],
  ['bms-zip','BMS 谱面包','.bms + music.ogg'],
  ['mdm','CustomAlbums','.mdm'],
  ['epk','Euterpe 谱面包','manifest.epk + map*.bms + music.ogg'],
  ['epk-only','Euterpe 清单','manifest.epk'],
  ['json','工作室项目备份','.json'],
];

function openDialog(convert=false) {
  dialog(convert?t('打开谱面以转换','Open a chart to convert','変換する譜面を開く'):t('打开谱面','Open chart','譜面を開く'),
    `<p>${t('支持 .mdcpmf、.bms、.mdm、Euterpe .epk、ZIP 和项目备份。可同时选择谱面、音频和封面。','Supports .mdcpmf, .bms, .mdm, Euterpe .epk, ZIP and project backups. Select the chart, audio and cover together.','MDC PMF、BMS、MDM、EPK、ZIP とプロジェクトを開けます。音源とカバーも同時に選べます。')}</p>`+
    choices([
      [convert?'choose-convert':'choose-files',t('选择文件','Choose files','ファイルを選択'),t('谱面或压缩包','Chart or archive','譜面・アーカイブ'),'file'],
      [convert?'folder-convert':'choose-folder',t('选择文件夹','Choose folder','フォルダを選択'),t('MDCP、BMS 或 Euterpe 谱面目录','MDCP, BMS or Euterpe chart directory','MDCP、BMS、Euterpe の譜面フォルダ'),'folder'],
    ]),null);
}
function exportDialog(converting=false) {
  const suggested=p.format==='mdcpmf'?'mdcp-zip':p.format==='bms'?'bms':p.format;
  dialog(converting?t('转换当前谱面','Convert current chart','現在の譜面を変換'):t('保存与导出','Save & export','保存・書き出し'),
    `<p>${t('选择文件格式。包含音频的谱面包会将音频保存为 Ogg Vorbis。','Choose a format. Chart packages encode audio as Ogg Vorbis.','形式を選びます。譜面パッケージの音源は Ogg Vorbis で保存します。')}</p>
    ${field(t('文件格式','File format','形式'),select('format',formats.map(([id,label,detail])=>[id,`${s.lang==='zh_cn'?label:id.toUpperCase()} · ${detail}`]),suggested),true)}
    <p id="format-loss" role="status"></p>
    ${converting?button('convert-source',t('打开其他谱面以转换','Open another chart to convert','別の譜面を開く'),'folder','bordered'):button('save-now',t('仅保存到此设备','Save on this device','端末に保存'),'check','bordered')}`,
    t('下载','Download','ダウンロード'),async data=>performExport(data.get('format')));
  updateLoss(suggested);
}
function updateLoss(format) {
  const el=$('format-loss');
  if(!el) return;
  const loss=formatLoss(format,p,documents);
  el.textContent=loss.length ? t(`目标格式无法完整保留 ${loss.join('、')}。请同时保存原格式备份。`,`The target format cannot fully preserve ${loss.join(', ')}. Keep a backup in the source format.`,`変換先の形式では ${loss.join('、')} を完全に保存できません。元形式も保存してください。`) : '';
}
async function performExport(format) {
  if(busy) return;
  busy=true;
  const submit=dlg.querySelector('[type=submit]');
  if(submit) submit.disabled=true;
  showToast(t('正在生成下载','Preparing download','ダウンロードを準備中'));
  try {
    let audio=assets.audio?.blob;
    const needsAudio=['mdcp-zip','bms-zip','mdm','epk'].includes(format);
    if(needsAudio && !audio && !p.demo) throw new Error(t('请先为谱面添加音频。','Add the chart audio first.','先に音源を追加してください。'));
    if(needsAudio && !await isVorbis(audio)) {
      if(!transport.buffer) throw new Error(t('无法解码项目音频','The project audio could not be decoded','音源をデコードできません'));
      audio=await encodeOgg(transport.buffer);
    }
    let cover=assets.cover;
    const coverTypes=format==='mdm'?['image/png','image/gif']:['image/png'];
    if(cover && ['mdcp-zip','mdm','epk'].includes(format) && !coverTypes.includes(cover.blob.type) && !(format==='epk' && ['image/webp','image/gif'].includes(cover.blob.type))) {
      cover={name:'cover.png',blob:await makePng(cover.blob)};
    }
    const result=await exportFile(format,p,documents,{...assets,cover,audio:audio?{name:p.audioName,blob:audio}:null});
    const url=URL.createObjectURL(result.blob);
    const link=document.createElement('a');
    link.href=url;link.download=result.name;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    dlg.close();
    showToast(t(`已生成 ${result.name}`,`Downloaded ${result.name}`,`${result.name} を書き出しました`));
  } catch(error) {showToast(error.message,true);}
  finally {busy=false;if(submit)submit.disabled=false;}
}
async function isVorbis(blob) {
  if(!blob) return false;
  const prefix=new TextDecoder().decode(await blob.slice(0,128).arrayBuffer());
  return prefix.startsWith('OggS') && prefix.includes('vorbis');
}

function metadataDialog(create=false) {
  const model=create?makeProject({name:t('未命名谱面','Untitled chart','無題の譜面')}):p;
  const audioHint=t('编辑长度留空时使用音频时长，无音频时为 60 秒。','Leave length blank to use the audio duration, or 60 seconds for a silent chart.','長さを空欄にすると音源の長さが使われます。音源がない場合は60秒です。');
  const body=`<div class="dialog-grid">
    ${field(t('曲目标题','Title','タイトル'),input('name',model.name,'text',`required maxlength="200"${create?' autofocus':''}`),true)}
    ${field(t('艺术家','Artist','アーティスト'),input('artist',model.artist,'text','maxlength="180"'))}
    ${field(t('谱师','Charter','譜面制作者'),input('designer',model.designer,'text','maxlength="180"'))}
    ${field(t('难度','Difficulty','難易度'),select('difficulty',difficulties.map((value,i)=>[value,difficultyNames()[i]]),model.difficulty))}
    ${field(t('等级','Rating','レベル'),input('level',model.level,'text','maxlength="30"'))}
    ${field(t('场景','Scene','背景'),select('scene',scenes.map(([value,label])=>[value,label]),model.scene))}
    ${field('BPM',input('bpm',model.bpm,'number','min="1" max="9999" step="any" required'))}
    ${field(t('编辑长度（秒）','Chart length (s)','譜面の長さ（秒）'),input('duration',create?'':model.duration,'number',`min="1" max="86400" step="any" ${create?`placeholder="${t('自动','Auto','自動')}" aria-describedby="new-chart-audio-hint"`:'required'}`))}
    ${field(t('项目格式','Project format','プロジェクト形式'),select('project-format',[['mdcpmf','MDCP'],['bms','BMS'],['mdm','CustomAlbums'],['epk','Euterpe']],model.format))}
    ${!create ? field(t('预览起点（秒）','Preview start (s)','試聴開始（秒）'),input('previewStart',model.previewStart,'number','min="0" step="any"')) : field(t('音频（可选）','Audio (optional)','音源（任意）'),'<input type="file" name="new-audio" accept="audio/*,.ogg,.wav,.mp3,.flac">',true)}
    ${!create ? field(t('预览结束（秒）','Preview end (s)','試聴終了（秒）'),input('previewEnd',model.previewEnd,'number','min="0" step="any"')) : ''}
    </div>${create?`<p id="new-chart-audio-hint">${audioHint}</p>${bpmControls()}<p id="new-chart-error" class="form-error" role="alert" hidden></p>`:documents.length>1 ? field(t('难度谱面','Maps in this package','パッケージ内の譜面'),select('switch-chart',documents.map(chart=>[chart.id,`${chart.difficulty} · ${chart.name}`]),p.id),true):''}`;
  dialog(create?t('新建谱面','New chart','新しい譜面'):t('谱面信息','Chart information','譜面情報'),body,create?t('创建谱面','Create chart','譜面を作成'):t('应用','Apply','適用'),async data=>{
    const values=Object.fromEntries(['name','artist','designer','difficulty','level','scene'].map(key=>[key,String(data.get(key)||'').trim()]));
    values.format=data.get('project-format');
    for(const key of ['bpm','duration','previewStart','previewEnd']) values[key]=num(data.get(key),model[key]);
    if(create) {
      values.name ||= model.name;
      await createChart(values,$('dialog-form').elements['new-audio'].files[0],data.get('duration')==='');
      return;
    }
    if(values.previewEnd && (values.previewEnd<values.previewStart || values.previewEnd>values.duration)) throw new Error(t('预览范围无效','Invalid preview range','試聴範囲が無効です'));
    change(chart=>Object.assign(chart,values,{demo:chart.demo,bmsDurationExplicit:true}));
    dlg.close();
  });
}

async function createChart(values,audio,autoLength) {
  const form=$('dialog-form');
  const submit=form.querySelector('[type=submit]');
  const error=$('new-chart-error');
  error.hidden=true;
  busy=true;
  submit.disabled=true;
  try {
    let buffer;
    const nextAssets={extras:{}};
    if(audio?.name) {
      try {buffer=await decodeNewAudio(audio);}
      catch {
        if(!dlg.open || $('dialog-form')!==form || form.elements['new-audio'].files[0]!==audio) return;
        form.elements['new-audio'].value='';
        form.elements['new-audio'].dispatchEvent(new Event('change',{bubbles:true}));
        error.textContent=t('无法读取这段音频。请选择其他文件，或直接创建空白谱面。','Could not read this audio. Choose another file or create a silent chart.','音源を読み込めません。別のファイルを選ぶか、音源なしで作成してください。');
        error.hidden=false;
        return;
      }
      const request=bpmRequests.get(form);
      if(request?.file===audio && !form.elements.bpm.dataset.edits) await request.promise;
      if(form.elements['new-audio'].files[0]!==audio) return;
      values.bpm=clamp(num(form.elements.bpm.value,values.bpm),1,9999);
      nextAssets.audio={name:audio.name,blob:audio};
      values.duration=clamp(round(autoLength?buffer.duration:Math.max(values.duration,buffer.duration)),1,86400);
    }
    if(!dlg.open || $('dialog-form')!==form) return;
    if((p.id!==initialDemoId || undo.length || s.curveDraft || !s.saved) && !confirm(t('新建谱面会替换当前工作区。要保留当前项目，请先导出。继续新建？','Creating a chart replaces the current workspace. Export the current project first if you want to keep it. Continue?','譜面を新規作成すると現在のワークスペースが置き換わります。残したいプロジェクトは先に書き出してください。続けますか？'))) return;
    s.mobile='editor';
    s.mode='draw';
    s.category='normal';
    s.noteType='small_1';
    await switchPackage([makeProject({...values,bmsDurationExplicit:true})],nextAssets,buffer);
    if(dlg.open && $('dialog-form')===form) dlg.close();
  } finally {
    busy=false;
    submit.disabled=false;
  }
}

function bpmControls(high=false) {
  return `<div class="bpm-actions">
    ${button('estimate',t('自动测算 BPM','Detect BPM','BPM を自動検出'),'metronome','bordered','normal')}
    ${high?button('estimate',t('高 BPM 测算','Detect fast BPM','高 BPM を検出'),'metronome','bordered','high'):''}
    </div><p class="bpm-status" role="status" hidden></p>`;
}
function setBpmStatus(form,message,error=false) {
  const status=form.querySelector('.bpm-status');
  status.textContent=message;
  status.hidden=!message;
  status.classList.toggle('form-error',error);
}
function decodeNewAudio(file) {
  if(!decodedFiles.has(file)) decodedFiles.set(file,transport.decode(file));
  return decodedFiles.get(file);
}
function measureFormBpm(form,mode) {
  const field=form.elements.bpm;
  const input=form.elements['new-audio'];
  const file=input?.files[0];
  const revision=field.dataset.edits;
  const request={file};
  bpmRequests.set(form,request);
  const current=()=>dlg.open && $('dialog-form')===form && bpmRequests.get(form)===request;
  const buttons=form.querySelectorAll('[data-action=estimate]');
  buttons.forEach(control=>control.disabled=true);
  setBpmStatus(form,t('正在测算 BPM…','Detecting BPM…','BPM を検出中…'));
  request.promise=(async()=>{
    try {
      const audio=input ? (file && await decodeNewAudio(file)) : transport.buffer;
      if(!current()) return;
      if(!audio) return setBpmStatus(form,t('请先选择音频。','Choose audio first.','先に音源を選択してください。'),true);
      const bpm=await estimateBpm(audio,mode==='high');
      if(!current()) return;
      if(bpm===null) return setBpmStatus(form,t('未能辨识稳定节拍，请手动填写 BPM。','No stable beat was detected. Enter the BPM manually.','安定した拍を検出できませんでした。BPM を手入力してください。'),true);
      if(field.dataset.edits===revision) {
        field.value=bpm;
        field.dataset.detected='true';
        delete field.dataset.edits;
      }
      setBpmStatus(form,t(`测算结果 · ${bpm} BPM`,`Estimated tempo · ${bpm} BPM`,`推定テンポ · ${bpm} BPM`));
    } catch {
      if(current()) setBpmStatus(form,t('无法读取音频以测算 BPM。','Could not read the audio for BPM detection.','BPM の検出に必要な音源を読み込めません。'),true);
    } finally {
      if(current()) buttons.forEach(control=>control.disabled=false);
    }
  })();
  return request.promise;
}
function gridDialog() {
  dialog(t('格线与节拍','Grid & BPM','グリッドと BPM'),
    `<div class="dialog-grid">
      ${field(t('基础 BPM','Base BPM','基準 BPM'),input('bpm',p.bpm,'number','min="1" max="9999" step="any" required'))}
      ${field(t('自定义细分','Grid subdivision','グリッド分割'),input('division',s.division,'number','min="1" max="384" required'))}
      ${field(t('每小节拍数','Beats per bar','拍子'),input('numerator',p.numerator,'number','min="1" max="64" required'))}
      ${field(t('拍值','Beat unit','音価'),select('denominator',[1,2,4,8,16,32].map(n=>[n,'1/'+n]),p.denominator))}
      ${field(t('格线偏移（秒）','Grid offset (s)','グリッドオフセット（秒）'),input('offset',p.offset,'number','step="any"'))}
      ${field(t('曲线水平细分','Curve position subdivisions','カーブ位置の分割'),input('curveDivision',s.curveDivision,'number','min="1" max="256"'))}
      ${checkbox('grid',t('显示格线','Show grid','グリッドを表示'),s.grid)}
      ${checkbox('strict',t('严格吸附','Strict snap','厳密な吸着'),s.strict)}
    </div>
    ${bpmControls(true)}
    ${button('tempo-here',t('在播放头处添加节拍点','Add tempo marker at playhead','再生ヘッドにテンポ点を追加'),'plus','bordered')}`,
    t('应用','Apply','適用'),data=>{
      for(const key of ['division','curveDivision']) s[key]=num(data.get(key),s[key]);
      for(const key of ['grid','strict']) s[key]=data.has(key);
      const values=Object.fromEntries(['bpm','numerator','denominator','offset'].map(key=>[key,num(data.get(key),p[key])]));
      change(chart=>Object.assign(chart,values,{mdcpDivision:s.division,mdcpGrid:s.grid}));
      if(transport.time()>p.duration) seek(p.duration,true);
      storePreferences();render();dlg.close();
    });
}
function tempoDialog(tempo,create) {
  dialog(t('节拍调整','Tempo marker','テンポ点'),
    `<div class="dialog-grid">
      ${field(t('时间（秒）','Time (s)','時間（秒）'),input('time',tempo.time,'number','min=".0001" max="'+p.duration+'" step="any" required'))}
      ${field('BPM',input('bpm',tempo.bpm,'number','min="1" max="9999" step="any" required'))}
      ${field(t('每小节拍数','Beats per bar','拍子'),input('numerator',tempo.numerator,'number','min="1" max="64" required'))}
      ${field(t('拍值','Beat unit','音価'),select('denominator',[1,2,4,8,16,32].map(n=>[n,'1/'+n]),tempo.denominator))}
    </div>`,t('应用','Apply','適用'),data=>{
      const item={...tempo,...Object.fromEntries(['time','bpm','numerator','denominator'].map(key=>[key,num(data.get(key),tempo[key])]))};
      if(p.tempos.some(change=>change.id!==item.id&&change.time===item.time)) throw new Error(t('该位置已有节拍点','A tempo marker already exists here','この位置にはテンポ点があります'));
      s.selected=new Set([item.id]);
      change(chart=>{if(create) chart.tempos.push(item);else Object.assign(chart.tempos.find(x=>x.id===item.id),item);});
      dlg.close();
    });
}

async function resetEditor(decodedAudio) {
  undo=[];redo=[];s.selected.clear();s.selectedNode=null;s.curveDraft=null;s.layer=p.layers.find(layer=>layer.visible)?.id??p.layers[0].id;
  s.board=p.axes.length>0;
  if(p.format==='mdcpmf' && p.mdcpDivision) {s.division=p.mdcpDivision;s.grid=p.mdcpGrid!==false;}
  s.loopEnabled=false;s.loopStart=p.previewStart||0;s.loopEnd=p.previewEnd||Math.min(p.duration,15);
  timeline.start=0;
  transport.setBuffer(null,p.duration);
  refreshCover();
  render();
  await loadAudio(decodedAudio);
}
async function switchPackage(charts,newAssets,decodedAudio) {
  documents=charts.map(normalizeProject);
  p=documents[0];
  assets=newAssets;
  await resetEditor(decodedAudio);
  queueSave();
}
function refreshCover() {
  if(coverUrl) URL.revokeObjectURL(coverUrl);
  coverUrl=assets.cover?URL.createObjectURL(assets.cover.blob):'';
}
async function loadAudio(decodedAudio) {
  const generation=++audioGeneration;
  try {
    const buffer=decodedAudio ?? (assets.audio ? await transport.decode(assets.audio.blob) : p.demo ? makeDemoAudio(transport.context(),p.duration,p.bpm) : null);
    if(generation!==audioGeneration) return;
    if(buffer && p.bmsSourceName && !p.bmsDurationExplicit) {
      p.duration=Math.max(p.duration,round(buffer.duration));
      render();
    }
    transport.setBuffer(buffer,p.duration);
    timeline.draw();
  } catch {
    if(generation===audioGeneration) showToast(t('谱面已打开，音频无法解码。','Chart opened, but the audio could not be decoded.','譜面を開きましたが、音源をデコードできません。'),true);
  }
}
async function loadInput(files,convert=false) {
  if(!files.length || busy) return;
  if(!s.saved && !s.autosave && !confirm(t('打开文件并放弃未保存的修改？','Discard unsaved changes and open the files?','未保存の変更を破棄しますか？'))) return;
  busy=true;
  showToast(t('正在读取谱面','Reading chart','譜面を読み込み中'));
  try {
    const result=await openFiles(files);
    await switchPackage(result.documents,result.assets);
    setMobile('editor');
    if(p.manifestOnly) showToast(t('已读取 Euterpe 清单。要编辑音符，请将 map*.bms 一同打开。','Euterpe manifest loaded. Open it together with map*.bms to edit notes.','Euterpe のマニフェストを読み込みました。ノーツ編集には map*.bms も開いてください。'));
    else showToast(t(`已打开 ${result.documents.length} 张谱面`,`Opened ${result.documents.length} chart(s)`,`${result.documents.length} 件の譜面を開きました`));
    if(convert) exportDialog(true);
    else if(dlg.open) dlg.close();
  } catch(error) {showToast(error.message,true);}
  finally {busy=false;}
}

function layersDialog() {
  dialog(t('谱面层级','Chart layers','レイヤー'),
    `<p>${t('当前编辑层始终可见。点击层级名称可切换编辑对象。','The current editing layer stays visible. Choose a layer to edit it.','編集中のレイヤーは常に表示されます。')}</p>
    ${p.layers.map(layer=>`<div class="dialog-row">
      ${field(t(`层级 ${layer.id}`,`Layer ${layer.id}`,`レイヤー ${layer.id}`),input('layer-name-'+layer.id,layer.name,'text','maxlength="80"'))}
      ${iconButton('set-layer',t('切换到此层','Edit this layer','このレイヤーを編集'),'pencil',active(s.layer===layer.id),layer.id)}
      ${iconButton('toggle-layer',t('切换可见性','Toggle visibility','表示切替'),layer.visible?'eye':'eyeOff','',layer.id)}
      ${iconButton('delete-layer',t('删除层级','Delete layer','レイヤーを削除'),'trash','danger',layer.id)}
    </div>`).join('')}
    ${button('add-layer',t('添加层级','Add layer','レイヤーを追加'),'plus','bordered')}`,
    t('应用','Apply','適用'),data=>{
      change(chart=>chart.layers.forEach(layer=>{layer.name=String(data.get('layer-name-'+layer.id)||'').trim() || ('Layer '+layer.id);}));
      dlg.close();
    });
}
function setLayer(id) {
  const layer=p.layers.find(layer=>layer.id===id);
  if(!layer) return;
  s.layer=id;
  s.selected.clear();s.selectedNode=null;
  if(!layer.visible) change(()=>{layer.visible=true;});
  else render();
}
function toggleLayer(id) {
  if(id===s.layer) return showToast(t('当前编辑层须保持可见','The editing layer must stay visible','編集中のレイヤーは表示したままにします'),true);
  change(chart=>{const layer=chart.layers.find(layer=>layer.id===id);if(layer) layer.visible=!layer.visible;});
}
function filterDialog() {
  dialog(t('显示与选择过滤','View & selection filters','表示・選択フィルター'),
    `${checkbox('filterEnabled',t('开启显示过滤','Enable view filters','表示フィルターを有効にする'),s.filterEnabled)}
    ${checkbox('visibleLayers',t('允许选择其他可见层','Select across visible layers','表示中の他のレイヤーも選択'),s.visibleLayers)}
    <div class="dialog-grid">
      ${field(t('其他层透明度','Other layer opacity','他のレイヤーの不透明度'),input('layerOpacity',s.layerOpacity,'range','min="0" max="1" step=".05"'))}
      ${field(t('非当前类别透明度','Other category opacity','他の分類の不透明度'),input('otherOpacity',s.otherOpacity,'range','min="0" max="1" step=".05"'))}
    </div>
    <h3>${t('显示轨道','Visible lanes','表示するレーン')}</h3>
    <div class="dialog-grid">${tracks.map(row=>checkbox('track-'+row.id,t(row.name,row.en,row.ja),!s.hiddenTracks.has(row.id))).join('')}</div>
    <h3>${t('隐藏类别 / 禁止选择类别','Hidden / unselectable categories','非表示・選択不可の分類')}</h3>
    ${Object.keys(groups).map((group,i)=>`<div class="dialog-grid">${checkbox('hide-'+group,groupLabels()[i],s.hiddenGroups.has(group))}${checkbox('select-'+group,groupLabels()[i],s.selectionTypes.has(group))}</div>`).join('')}
    <details><summary>${t('隐藏指定音符类型','Hide individual note types','個別のノーツを非表示')}</summary>
    <div class="dialog-grid list-scroll">${Object.values(groups).flat().map(type=>checkbox('type-'+type,nLabel(type),s.hiddenTypes.has(type))).join('')}</div>
    </details>`,
    t('应用','Apply','適用'),data=>{
      s.filterEnabled=data.has('filterEnabled');s.visibleLayers=data.has('visibleLayers');
      s.layerOpacity=clamp(num(data.get('layerOpacity')),0,1);s.otherOpacity=clamp(num(data.get('otherOpacity')),0,1);
      s.hiddenTracks=new Set(tracks.filter(track=>!data.has('track-'+track.id)).map(track=>track.id));
      s.hiddenGroups=new Set(Object.keys(groups).filter(group=>data.has('hide-'+group)));
      s.selectionTypes=new Set(Object.keys(groups).filter(group=>data.has('select-'+group)));
      s.hiddenTypes=new Set(Object.values(groups).flat().filter(type=>data.has('type-'+type)));
      storePreferences();render();dlg.close();
    });
}
function axisDialog(id) {
  const axis=p.axes.find(axis=>axis.id===id);
  const options=groups.effect;
  const type=axis?.type || s.defaultAxis;
  dialog(t('特效轴','Effect lane','エフェクトレーン'),
    `<div class="dialog-grid">
      ${field(t('特效类型','Effect type','エフェクト種類'),select('axis-type',options.map(type=>[type,nLabel(type)]),type))}
      ${field(t('影响层级','Affected layer','対象レイヤー'),select('axis-layer',[[-1,t('全局','Global','グローバル')],...p.layers.map(layer=>[layer.id,layer.name])],axis?.layer ?? (isGlobalAxis(type)?-1:s.layer)))}
    </div>
    ${axis?button('axis-at',t('在播放头处添加关键帧','Add keyframe at playhead','再生ヘッドにキーフレームを追加'),'plus','bordered',axis.id)+button('axis-remove',t('删除特效轴和关键帧','Delete lane and keyframes','レーンとキーフレームを削除'),'trash','danger bordered',axis.id):''}`,
    axis?t('应用','Apply','適用'):t('添加特效轴','Add lane','レーン追加'),data=>{
      const newType=data.get('axis-type');
      const selectedLayer=num(data.get('axis-layer'));
      const newLayer=isGlobalAxis(newType)?-1:selectedLayer===-1?s.layer:selectedLayer;
      if(p.axes.some(x=>x.type===newType&&x.layer===newLayer&&x.id!==id)) throw new Error(t('该层级已存在这种特效轴','This layer already has that effect lane','同じ種類のレーンがあります'));
      s.board=true;
      if(newLayer!==-1) setLayer(newLayer);
      change(chart=>{
        if(axis) {
          axis.type=newType;axis.layer=newLayer;
          for(const note of chart.notes.filter(note=>note.axisId===axis.id)) {
            if(note.type!==newType) {
              note.type=newType;note.value=makeNote(newType,note.time,'effect',newLayer).value;
            }
            note.layer=newLayer;
          }
        } else chart.axes.push({id:uid(),type:newType,layer:newLayer});
      });
      dlg.close();
    });
}
function audioDialog() {
  dialog(t('音频与封面','Audio & cover','音源とカバー'),
    choices([
      ['choose-audio',t('选择音频','Choose audio','音源を選択'),assets.audio?.name || t('OGG、MP3、WAV、FLAC 等','OGG, MP3, WAV, FLAC and more','OGG、MP3、WAV、FLAC など'),'music'],
      ['choose-cover',t('选择封面','Choose cover','カバーを選択'),assets.cover?.name || t('PNG、WebP、GIF 等','PNG, WebP, GIF and more','PNG、WebP、GIF など'),'file'],
    ])+`<div class="dialog-grid">
      ${field(t('BMS 音频名称','BMS audio filename','BMS 音源ファイル名'),input('audioName',p.audioName,'text','maxlength="150" aria-describedby="bms-filename"'),true)}
      ${renderAudioLevels(t,s)}
      ${checkbox('waveform',t('显示波形','Show waveform','波形を表示'),s.waveform)}
    </div><p id="bms-filename">${t('用于 BMS 的 #WAV10 引用。MDCP 和 Euterpe 谱面包使用 music.ogg。','Used by the BMS #WAV10 reference. MDCP and Euterpe packages use music.ogg.','BMS の #WAV10 の参照先。MDCP と Euterpe は music.ogg を使用します。')}</p>
    ${assets.cover?button('remove-cover',t('移除封面','Remove cover','カバーを削除'),'trash','danger bordered'):''}
    ${assets.audio?button('remove-audio',t('移除音频','Remove audio','音源を削除'),'trash','danger bordered'):''}
    ${button('preview-range',t('试听预览区间','Play preview range','試聴区間を再生'),'play','bordered')}`,
    t('应用','Apply','適用'),data=>{
      const name=String(data.get('audioName')||'').trim();
      if(/[\\/:*?"<>|]/.test(name)) throw new Error(t('音频文件名含有无效字符','Invalid audio filename','無効なファイル名です'));
      change(chart=>{chart.audioName=name || 'music.ogg';});
      s.waveform=data.has('waveform');
      applyPreferences();storePreferences();render();dlg.close();
    });
}
function loopDialog() {
  dialog(t('循环播放','Loop playback','ループ再生'),`<div class="dialog-grid">
    ${field(t('起点（秒）','Start (s)','開始（秒）'),input('loopStart',s.loopStart,'number','min="0" step="any" required'))}
    ${field(t('终点（秒）','End (s)','終了（秒）'),input('loopEnd',s.loopEnd,'number','min="0" step="any" required'))}
    </div>`,t('开启循环','Enable loop','ループを有効にする'),data=>{
      const start=num(data.get('loopStart')),end=num(data.get('loopEnd'));
      if(start>=end || end>p.duration) throw new Error(t('循环范围无效','Invalid loop range','ループ範囲が無効です'));
      s.loopEnabled=true;s.loopStart=start;s.loopEnd=end;
      if(transport.time()<start||transport.time()>=end) seek(start,true);
      updatePlayControls();timeline.draw();dlg.close();
    });
}
function findings() {
  const labels={
    range:t('超出编辑长度','Outside the chart length','譜面範囲外'),unknown:t('无法识别的音符类型','Unrecognized note type','不明なノーツの種類'),
    bossRange:t('首领音符位于首领段外','Boss object outside a boss section','ボス区間外のノーツ'),
    overlap:t('同轨道音符重叠','Overlapping notes on the same lane','同じレーンでノーツが重なっています'),
    doubleGear:t('双押与齿轮重叠','Double note overlaps a gear','同時押しとギアが重なっています'),
    bossOpen:t('首领未退场','Boss has no outro','ボス退場がありません'),
  };
  return designCheck(p).map(item=>({...item,label:labels[item.code]}));
}
function checkDialog() {
  const items=findings();
  dialog(t('设计检查','Chart validation','譜面チェック'),
    `<p>${items.length?t(`发现 ${items.length} 条检查结果。`,`Found ${items.length} issue(s).`,`${items.length} 件の結果。`):t('未发现设计异常。','No issues found.','問題は見つかりませんでした。')}</p>
    ${items.length?`<div class="list-scroll">${items.map(({label,time,note})=>button('jump-issue',`${timecode(time)} · ${label}${note?' · '+nLabel(note.type):''}`,null,'small subtle',note?.id || String(time))).join('')}</div>
    ${button('copy-findings',t('复制检查结果','Copy report','レポートをコピー'),'copy','bordered')}
    ${items.some(x=>x.code==='range')?button('delete-range',t('删除超界音符','Remove out-of-range notes','範囲外のノーツを削除'),'trash','danger bordered'):''}
    ${items.some(x=>x.code==='unknown')?button('delete-unknown',t('删除无效音符','Remove unrecognized notes','不明なノーツを削除'),'trash','danger bordered'):''}`:''}`,null);
}
const bindings={
  play:['Space','播放 / 暂停','Play / pause','再生・一時停止'],save:['Ctrl+S','保存到此设备','Save local project','保存'],
  undo:['Ctrl+Z','撤销','Undo','元に戻す'],redo:['Ctrl+Y','重做','Redo','やり直す'],
  copy:['Ctrl+C','复制','Copy','コピー'],copyLayer:['Ctrl+Shift+C','复制到当前层','Copy onto current layer','現在のレイヤーへコピー'],
  paste:['Ctrl+V','粘贴到播放头','Paste at playhead','再生ヘッドに貼り付け'],delete:['Delete','删除','Delete','削除'],
  mirror:['Ctrl+M','镜像','Mirror','反転'],all:['Ctrl+A','全选','Select all','すべて選択'],
  left:['A','向左移动视野','Scroll left','左へスクロール'],right:['D','向右移动视野','Scroll right','右へスクロール'],
  accelerate:['Shift+D','快速平移','Scroll faster','高速スクロール'],
  follow:['L','跟随播放头','Follow playhead','再生ヘッド追従'],indicator:['I','切换播放指示器','Toggle playhead','再生マーカー切替'],
  snap:['M','切换吸附','Toggle snap','吸着切替'],filters:['F','切换显示过滤','Toggle view filters','表示フィルター切替'],
  mode:['Tab','切换绘制和选择','Switch draw / select','描画・選択を切替'],submode:['Shift+Tab','切换选择 / 绘制子模式','Switch selection or drawing submode','サブモード切替'],
  heart:['Ctrl+H','附加 / 移除红心','Toggle attached heart','ハート切替'],
  rateUp:['Equal','提高播放速度','Increase playback rate','再生速度を上げる'],rateDown:['Minus','降低播放速度','Decrease playback rate','再生速度を下げる'],
  layerUp:['BracketRight','下一层','Next layer','次のレイヤー'],layerDown:['BracketLeft','上一层','Previous layer','前のレイヤー'],
  up:['Q','入场向上','Entrance up','上から登場'],normal:['W','入场水平','Straight entrance','水平に登場'],down:['E','入场向下','Entrance down','下から登場'],
  low:['Digit1','低流速','Low scroll speed','低速'],medium:['Digit2','中流速','Medium scroll speed','中速'],high:['Digit3','高流速','High scroll speed','高速'],
  cat1:['F1','常规音符','Notes','ノーツ'],cat2:['F2','动作音符','Actions','アクション'],cat3:['F3','特效','Effects','エフェクト'],
  cat4:['F4','节拍工具','Tempo','テンポ'],cat5:['F5','专用音符','CustomPlay','CustomPlay'],cat6:['F6','BMS 音符','BMS','BMS'],
  curvePrevious:['R','上一曲线类型','Previous curve type','前のカーブ'],curveNext:['T','下一曲线类型','Next curve type','次のカーブ'],
  relocate:['Ctrl+Digit0','重置视野','Reset view','表示をリセット'],
};
function settingsDialog() {
  const settings=[
    ['autosave',t('自动保存到此设备','Autosave on this device','端末に自動保存')],
    ['mirrorDirection',t('镜像时同时镜像入场','Mirror entrance direction','登場方向も反転')],
    ['metronome',t('节拍器','Metronome','メトロノーム')],
    ['noteClick',t('音符击打提示音','Note hit sounds','打音')],
    ['indicator',t('显示播放头','Show playhead','再生ヘッドを表示')],
    ['follow',t('跟随播放头','Follow playhead','再生ヘッド追従')],
    ['vsync',t('跟随屏幕刷新率','Sync to display refresh rate','画面の更新頻度に同期')],
  ];
  dialog(t('编辑器设置','Editor settings','エディター設定'),
    `<div class="dialog-grid">
      ${field(t('语言','Language','言語'),select('lang',[['zh_cn','简体中文'],['en_us','English'],['ja_jp','日本語']],s.lang))}
      ${field(t('帧率上限','Frame rate cap','最大フレームレート'),select('fps',[30,45,60,90,120,144,240].map(fps=>[fps,fps+' FPS']),s.fps,s.vsync?'disabled':''))}
      ${field(t('默认特效类型','Default effect type','初期エフェクト'),select('defaultAxis',groups.effect.map(type=>[type,nLabel(type)]),s.defaultAxis),true)}
      ${field(t('选择子模式','Selection submode','選択サブモード'),select('submode',[['object',t('整个对象','Object','オブジェクト')],['node',t('曲线节点','Curve node','カーブノード')],['segment',t('曲线段','Curve segment','カーブ区間')]],s.submode),true)}
      ${settings.map(([key,label])=>checkbox(key,label,s[key])).join('')}
      ${checkbox('slideFill',t('绘制拖动连续填充','Drag to fill grid slots','ドラッグで連続配置'),s.slideFill)}
    </div>
    <div class="dialog-grid">
      ${button('fullscreen',t('切换全屏','Toggle fullscreen','全画面切替'),'fullscreen','bordered')}
      ${button('keys',t('编辑快捷键','Edit shortcuts','ショートカット編集'),'sliders','bordered')}
    </div>`,t('应用','Apply','適用'),data=>{
      for(const [key] of settings) s[key]=data.has(key);
      s.lang=data.get('lang');s.fps=num(data.get('fps'),s.fps);s.defaultAxis=data.get('defaultAxis');
      s.submode=data.get('submode');s.slideFill=data.has('slideFill');
      applyPreferences();storePreferences();render();dlg.close();
      if(s.autosave&&!s.saved) queueSave();
    });
}
function keyDialog() {
  dialog(t('键位设置','Keyboard shortcuts','キーボードショートカット'),
    `<p>${t('可以输入组合键，也可以点选输入框后在键盘上按下组合键。','Enter a key combination or focus the field and press it on your keyboard.','キーの組み合わせを入力するか、項目を選択してキーを押します。')}</p>
    <div class="list-scroll dialog-grid">${Object.entries(bindings).map(([key,[code,...labels]])=>field(t(...labels),input(key,s.bindings?.[key]||code,'text','data-keybind maxlength="37"'))).join('')}</div>
    ${button('reset-keys',t('恢复默认键位','Reset defaults','初期値に戻す'),'undo','bordered')}`,
    t('保存','Save','保存'),data=>{
      const values=Object.fromEntries(Object.keys(bindings).map(key=>[key,String(data.get(key)||bindings[key][0]).trim()]));
      for(const [key,value] of Object.entries(values)) {
        if(!value || Object.entries(values).some(([other,combo])=>other!==key&&combo.toLowerCase()===value.toLowerCase())) throw new Error(t('快捷键重复或无效：','Duplicate or invalid shortcut: ','重複または無効なキー：')+value);
      }
      s.bindings=values;storePreferences();dlg.close();
    });
}
function helpDialog() {
  dialog(t('操作指南','Help & shortcuts','ヘルプ'),
    `<p>${t('从上方打开现有谱面，或在项目页新建。选择音符后点击时间轴放置，框选后可在属性页批量编辑。手机可用「平移」拖动时间轴、双指缩放，或拖动底部滑块。','Open a chart or create a project. Pick a note, tap to place it, or box-select notes and edit them in Inspector. On mobile, drag in Pan mode, pinch-to-zoom, or move the scroll thumb.','譜面を開くか新規作成して、ノーツを選んで配置します。範囲選択後にプロパティを編集できます。スマートフォンでは移動モードやピンチで操作します。')}</p>
    <p>${t('点选小节或波形以移动播放头。绘制曲线时依次放置节点，再点完成。选择故事板特效轴并切换到绘制模式可添加关键帧。','Tap the ruler or waveform to seek. Place curve nodes in order, then choose Finish. Select Draw mode and tap an effect lane to add a keyframe.','小節または波形をタップして再生位置を変更。カーブのノードを置いて完了を選択。描画モードでエフェクトレーンにキーフレームを追加できます。')}</p>
    <div class="list-scroll">${Object.entries(bindings).map(([key,[code,...labels]])=>`<div class="dialog-row"><span>${html(t(...labels))}</span><kbd class="kbd">${html(s.bindings?.[key]||code)}</kbd></div>`).join('')}</div>
    <p><a href="https://ruri77.com/archives/mdcp-editor-curve-inspector-storyboard.html" target="_blank" rel="noopener">CustomPlay Editor · ${t('曲线与故事板','Curves & storyboard','カーブ・ストーリーボード')}</a><br>
    <a href="https://euterpe-org.com/zh-CN/docs/ecosystem/from-mdmc" target="_blank" rel="noopener">Euterpe · ${t('谱面格式说明','Chart format','譜面形式')}</a></p>`,null);
}
function editListDialog() {
  const items=[...p.notes,...p.tempos.map(x=>({...x,type:'preset_beatbpm'}))].sort((a,b)=>a.time-b.time);
  const visible=items.filter(item=>!filterList || (nLabel(item.type)+' '+timecode(item.time)).toLowerCase().includes(filterList.toLowerCase()));
  const list=visible.slice(0,400).map(item=>button('jump-issue',timecode(item.time)+' · '+nLabel(item.type),null,'small subtle',item.id)).join('');
  dialog(t('谱面对象','Chart objects','譜面のオブジェクト'),
    `${field(t('搜索类型或时间','Search by type or time','種類・時間で検索'),input('search-list',filterList,'search'))}
    <div class="list-scroll" id="object-list">${list || t('没有符合条件的对象','No matching objects','一致する項目はありません')}</div>
    ${button('search-list',t('搜索','Search','検索'),'file','bordered')}
    ${s.clipboard.length?button('paste',t('粘贴到播放头','Paste at playhead','再生ヘッドに貼り付け'),'copy','bordered'):''}`,null);
}

const actions={
  new:()=>metadataDialog(true), open:()=>openDialog(), export:()=>exportDialog(), convert:()=>exportDialog(true),
  'convert-source':()=>openDialog(true), metadata:()=>metadataDialog(), 'grid-settings':gridDialog, audio:audioDialog,
  layers:layersDialog, filter:filterDialog, help:helpDialog, settings:settingsDialog, keys:keyDialog, 'edit-list':editListDialog,
  'close-dialog':()=>dlg.close(), 'save-now':()=>{save(true);dlg.close();},
  'choose-files':()=>picker('file-input'), 'choose-folder':()=>picker('folder-input'),
  'choose-convert':()=>picker('file-input',true), 'folder-convert':()=>picker('folder-input',true),
  'choose-audio':()=>$('audio-input').click(),'choose-cover':()=>$('cover-input').click(),
  'remove-cover':()=>{delete assets.cover;refreshCover();render();queueSave();audioDialog();},
  'remove-audio':()=>{delete assets.audio;loadAudio();render();queueSave();audioDialog();},
  mobile:setMobile, mode:setMode,
  category:value=>{s.category=value;s.noteType=groups[value][0];renderPaletteOnly();},
  'note-type':value=>{if(s.curveDraft) finishCurve();s.noteType=value;s.category=groupOf(value);setMode('draw');},
  'curve-finish':finishCurve,
  'curve-cancel':()=>{s.curveDraft=null;render();},
  'curve-extend':()=>{
    const item=selectedItems()[0];
    if(!item || !isCurve(item)) return;
    s.curveDraft={...clone(item),replace:true};
    s.noteType=item.type;s.category='mdcp';
    setMode('draw');setMobile('editor');
  },
  'node-add':()=>{
    const note=selectedItems()[0];
    if(!note?.nodes) return;
    const a=note.nodes.at(-2),b=note.nodes.at(-1);
    const time=round((a.time+b.time)/2);
    if(time<=a.time || time>=b.time) return;
    s.selectedNode={id:note.id,index:note.nodes.length-1};
    change(()=>note.nodes.splice(-1,0,{time,position:round((a.position+b.position)/2),curve:b.curve}));
  },
  'node-delete':value=>{
    const note=p.notes.find(note=>s.selected.has(note.id)&&isCurve(note));
    if(!note || note.nodes.length<=2) return showToast(t('曲线至少需要两个节点','A curve needs at least two nodes','カーブには少なくとも二つのノードが必要です'),true);
    change(()=>{note.nodes.splice(num(value),1);note.time=note.nodes[0].time;note.end=note.nodes.at(-1).time;s.selectedNode=null;});
  },
  undo:()=>undoRedo(), redo:()=>undoRedo(true),
  snap:()=>{s.snap=!s.snap;storePreferences();renderTools();},
  multi:()=>{s.multi=!s.multi;storePreferences();renderTools();},
  follow:()=>{s.follow=!s.follow;storePreferences();renderTools();},
  rewind:()=>seek(0,true), play, 'zoom-in':()=>timeline.zoom(1.35), 'zoom-out':()=>timeline.zoom(1/1.35),
  mute:()=>setAudioLevel('volume',s.volume?0:s.lastVolume),
  'audio-levels':toggleAudioLevels,
  loop:()=>{if(s.loopEnabled) {s.loopEnabled=false;updatePlayControls();timeline.draw();} else loopDialog();},
  preview:()=>preview.show(transport.time()),
  'preview-range':()=>{dlg.close();preview.show(p.previewStart || 0,true);},
  board:()=>{s.board=!s.board;renderTools();timeline.layout();timeline.draw();},
  'axis-add':()=>axisDialog(), 'axis-menu':axisDialog,
  'axis-at':id=>{dlg.close();insert('axis:'+id,snap(transport.time()));},
  'axis-remove':id=>{
    if(!confirm(t('删除特效轴及其关键帧？','Delete this lane and its keyframes?','レーンとキーフレームを削除しますか？'))) return;
    change(chart=>{chart.axes=chart.axes.filter(axis=>axis.id!==id);chart.notes=chart.notes.filter(note=>note.axisId!==id);});dlg.close();
  },
  'set-layer':value=>{const isLayers=dlg.open&&dlg.querySelector('[name^="layer-name-"]');setLayer(num(value));if(isLayers) layersDialog();},
  'toggle-layer':value=>{const isLayers=dlg.open&&dlg.querySelector('[name^="layer-name-"]');toggleLayer(num(value));if(isLayers)layersDialog();},
  'add-layer':()=>{
    const id=Math.max(...p.layers.map(layer=>layer.id))+1;
    s.layer=id;
    change(chart=>chart.layers.push({id,name:t('层级 '+id,'Layer '+id,'レイヤー '+id),visible:true}));
    layersDialog();
  },
  'delete-layer':value=>{
    if(p.layers.length<2) return showToast(t('至少保留一个层级','Keep at least one layer','少なくとも一つのレイヤーを残します'),true);
    if(!confirm(t('同时删除此层的音符和特效轴？','Delete the notes and effect lanes on this layer?','このレイヤーのノーツとエフェクトを削除しますか？'))) return;
    const id=num(value);
    change(chart=>{
      chart.layers=chart.layers.filter(layer=>layer.id!==id);
      chart.axes=chart.axes.filter(axis=>axis.layer!==id);
      chart.notes=chart.notes.filter(note=>note.layer!==id);
      if(s.layer===id) {s.layer=chart.layers[0].id;chart.layers[0].visible=true;}
    });
    layersDialog();
  },
  copy:()=>{copy();if(dlg.open)dlg.close();}, 'copy-layer':()=>copy(true), paste:()=>{paste();if(dlg.open)dlg.close();},
  mirror:()=>change(chart=>chart.notes.filter(note=>s.selected.has(note.id)).forEach(note=>mirrorNote(note,s.mirrorDirection))),
  delete:()=>{if(s.submode==='node'&&s.selectedNode) actions['node-delete'](s.selectedNode.index);else remove([...s.selected]);},
  estimate:value=>measureFormBpm($('dialog-form'),value),
  'tempo-here':()=>addTempo(snap(transport.time())),
  check:checkDialog,
  'copy-findings':async()=>{await navigator.clipboard.writeText(findings().map(x=>timecode(x.time)+' '+x.label).join('\n'));showToast(t('已复制检查结果','Report copied','レポートをコピーしました'));},
  'delete-range':()=>{remove(findings().filter(x=>x.code==='range').map(x=>x.note.id));checkDialog();},
  'delete-unknown':()=>{remove(findings().filter(x=>x.code==='unknown').map(x=>x.note.id));checkDialog();},
  'jump-issue':value=>{
    const item=selectedItems().find(x=>x.id===value)||p.notes.find(x=>x.id===value)||p.tempos.find(x=>x.id===value);
    if(item) {
      if(item.layer>=0) setLayer(item.layer);
      selectMany([item.id]);
    }
    seek(item?.time ?? num(value),true);
    dlg.close();setMobile('editor');
  },
  'search-list':()=>{filterList=dlg.querySelector('[name=search-list]').value;editListDialog();},
  fullscreen:async()=>{
    if(document.fullscreenElement) await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else showToast(t('此浏览器不支持全屏模式','Fullscreen is unavailable in this browser','このブラウザーは全画面に対応していません'),true);
  },
  'reset-keys':()=>{s.bindings={};storePreferences();keyDialog();},
};
function picker(id,convert=false) {
  const input=$(id);
  input.dataset.convert=String(convert);
  input.click();
}

document.addEventListener('click',async event=>{
  const control=event.target.closest('[data-action],[data-preview]');
  if(!control || control.disabled) return;
  try {
    if(control.dataset.preview) preview.action(control.dataset.preview);
    else await actions[control.dataset.action]?.(control.dataset.value);
  } catch(error) {showToast(error.message,true);}
});
dlg.addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.target.id!=='dialog-form' || !formHandler || busy) return;
  try {await formHandler(new FormData(event.target));}
  catch(error) {showToast(error.message,true);}
});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.dataset.inspect!==undefined) {
    const value=el.type==='checkbox'?el.checked:el.type==='number' || ['layer','speed','denominator'].includes(el.name)?num(el.value):el.value;
    editInspector(el.name,value);
  } else if(el.dataset.node!==undefined) {
    const kind=el.name.slice(5);
    curveNode(num(el.dataset.node),kind,kind==='curve'?el.value:num(el.value));
  } else if(el.name==='format') updateLoss(el.value);
  else if(el.name==='placement-curve') {s.curveType=el.value;renderPaletteOnly();}
  else if(el.name==='placement-direction') s.placementDirection=el.value;
  else if(el.name==='placement-speed') s.placementSpeed=num(el.value,2);
  else if(el.name==='division') {
    s.division=num(el.value,4);storePreferences();
    p.mdcpDivision=s.division;timeline.draw();queueSave();
  }
  else if(el.name==='rate') {s.rate=num(el.value,1);transport.setRate(s.rate);storePreferences();}
  else if(el.name==='vsync') dlg.querySelector('[name=fps]').disabled=el.checked;
  else if(el.name==='new-audio') {
    const form=el.form;
    const bpm=form.elements.bpm;
    bpmRequests.delete(form);
    form.querySelectorAll('[data-action=estimate]').forEach(control=>control.disabled=false);
    setBpmStatus(form,'');
    $('new-chart-error').hidden=true;
    if(bpm.dataset.detected) {
      bpm.value=bpm.defaultValue;
      delete bpm.dataset.detected;
    }
    if(el.files.length && !bpm.dataset.edits) await measureFormBpm(form,'normal');
  }
  else if(el.name==='switch-chart') {
    p=documents.find(chart=>chart.id===el.value)||p;await resetEditor();dlg.close();queueSave();
  } else if(el.id==='file-input'||el.id==='folder-input') {
    const files=[...el.files];el.value='';await loadInput(files,el.dataset.convert==='true');
  } else if(el.id==='audio-input') {
    const file=el.files[0];el.value='';
    if(!file) return;
    try {
      const buffer=await transport.decode(file);
      assets.audio={name:file.name,blob:file};
      p.demo=false;
      if(!p.notes.length || p.duration<buffer.duration) p.duration=round(buffer.duration);
      transport.setBuffer(buffer,p.duration);render();queueSave();
      if(dlg.open) audioDialog();
    } catch {showToast(t('无法解码该音频','Could not decode this audio file','この音源をデコードできません'),true);}
  } else if(el.id==='cover-input') {
    const file=el.files[0];el.value='';
    if(!file) return;
    assets.cover={name:file.name,blob:file};refreshCover();render();queueSave();
    if(dlg.open) audioDialog();
  }
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.name==='volume' || input.name==='waveformGain') setAudioLevel(input.name,num(input.value,s[input.name]));
  else if(input.name==='bpm') {
    input.dataset.edits=String(num(input.dataset.edits)+1);
    delete input.dataset.detected;
  }
});
window.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
window.addEventListener('drop',event=>{
  if(!event.dataTransfer.files.length)return;
  event.preventDefault();loadInput([...event.dataTransfer.files]);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!s.saved&&s.autosave)save();});
window.addEventListener('beforeunload',event=>{if(!s.saved&&!s.autosave)event.preventDefault();});

function keyCombo(event) {
  const parts=[];
  if(event.ctrlKey||event.metaKey) parts.push('Ctrl');
  if(event.altKey) parts.push('Alt');
  if(event.shiftKey) parts.push('Shift');
  const key=event.code.startsWith('Key')?event.code.slice(3):event.code;
  if(['ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(key)) return '';
  if(key) parts.push(key);
  return parts.join('+');
}
const keyActions={
  play, save:()=>save(true), undo:actions.undo, redo:actions.redo, copy:()=>copy(), copyLayer:()=>copy(true), paste, delete:actions.delete, mirror:actions.mirror,
  all:()=>selectMany([...visibleNotes().filter(selectable),...p.tempos].map(note=>note.id)),
  left:()=>scroll(-.25),right:()=>scroll(.25),accelerate:()=>scroll(.75),
  follow:actions.follow,indicator:()=>{s.indicator=!s.indicator;storePreferences();timeline.draw();},snap:actions.snap,
  filters:()=>{s.filterEnabled=!s.filterEnabled;storePreferences();timeline.draw();},
  mode:()=>setMode(s.mode==='select'?'draw':'select'),
  submode:()=>{
    if(s.mode==='draw') {s.slideFill=!s.slideFill;showToast(s.slideFill?t('已开启拖动填充','Drag fill enabled','連続配置オン'):t('已关闭拖动填充','Drag fill disabled','連続配置オフ'));}
    else {const modes=['object','node','segment'];s.submode=modes[(modes.indexOf(s.submode)+1)%modes.length];s.selectedNode=null;s.selectedSegment=null;showToast(t('选择模式','Selection mode','選択モード')+' · '+s.submode);}
    storePreferences();
  },
  heart:()=>{const item=selectedItems()[0];if(item)editInspector('heart',!item.heart);},
  rateUp:()=>stepRate(1),rateDown:()=>stepRate(-1),
  layerUp:()=>stepLayer(1),layerDown:()=>stepLayer(-1),
  up:()=>setEntrance('up'),normal:()=>setEntrance('normal'),down:()=>setEntrance('down'),
  low:()=>setSpeed(1),medium:()=>setSpeed(2),high:()=>setSpeed(3),
  cat1:()=>actions.category('normal'),cat2:()=>actions.category('action'),cat3:()=>actions.category('effect'),
  cat4:()=>actions.category('tempo'),cat5:()=>actions.category('mdcp'),cat6:()=>actions.category('bms'),
  curvePrevious:()=>stepCurve(-1),curveNext:()=>stepCurve(1),
  relocate:()=>{timeline.scale=104;timeline.center(transport.time());updateZoom();timeline.draw();},
};
function scroll(fraction) {timeline.setStart(timeline.start+timeline.width/timeline.scale*fraction);timeline.draw();}
function stepRate(diff) {
  const rates=[.25,.5,.75,1,1.25,1.5,2];
  s.rate=rates[clamp(rates.indexOf(s.rate)+diff,0,rates.length-1)];
  transport.setRate(s.rate);storePreferences();updatePlayControls();
}
function stepLayer(diff) {
  const index=clamp(p.layers.findIndex(layer=>layer.id===s.layer)+diff,0,p.layers.length-1);
  setLayer(p.layers[index].id);
}
function setEntrance(direction) {
  s.placementDirection=direction;
  if(s.mode==='select') editInspector('direction',direction);
  else showToast(t('入场','Entrance','登場')+' · '+stageNames(t).find(x=>x[0]===direction)[1]);
}
function setSpeed(speed) {
  s.placementSpeed=speed;
  if(s.mode==='select') editInspector('speed',speed);
  else showToast(t('流速','Scroll speed','流速')+' · '+stages(t).find(x=>x[0]===speed)[1]);
}
function stepCurve(delta) {
  const current=curves.findIndex(([type])=>type===s.curveType);
  s.curveType=curves[(current+delta+curves.length)%curves.length][0];
  if(s.selectedSegment) {
    const note=p.notes.find(note=>note.id===s.selectedSegment.id);
    if(note) change(()=>{note.nodes[s.selectedSegment.index].curve=s.curveType;});
  }
  renderPaletteOnly();
  showToast(t('线型','Curve','カーブ')+' · '+s.curveType);
}
document.addEventListener('keydown',event=>{
  if(event.target.dataset.keybind!==undefined && !['Escape','Tab'].includes(event.key)) {
    const combo=keyCombo(event);
    if(combo) {event.preventDefault();event.target.value=combo;}
    return;
  }
  if(event.target.matches('input,select,textarea,[contenteditable=true]')) return;
  if(preview.open) {
    const key=event.key.toLowerCase();
    if(key==='d'||key==='f') {event.preventDefault();preview.hit(key==='d'?'air':'road');}
    if(event.code==='Space'&&!event.target.matches('button')) {event.preventDefault();preview.action('play');}
    return;
  }
  if(dlg.open) return;
  if(event.key==='Enter'&&s.curveDraft) {event.preventDefault();finishCurve();return;}
  if(event.key==='Escape') {if(s.curveDraft)actions['curve-cancel']();else selectMany([]);return;}
  if(event.key==='Backspace'&&s.selected.size) {event.preventDefault();actions.delete();return;}
  if(event.key==='Tab' && event.target.id!=='timeline-canvas') return;
  if(event.code==='Space' && event.target.matches('button')) return;
  const combo=keyCombo(event);
  if(['ArrowLeft','ArrowRight','Shift+ArrowLeft','Shift+ArrowRight','Shift+A'].includes(combo) && event.target.id!=='scrub') {
    event.preventDefault();
    scroll((combo.endsWith('Left')||combo.endsWith('+A')?-1:1)*(combo.startsWith('Shift')?.75:.25));return;
  }
  if(combo==='Ctrl+Shift+Z' && !s.bindings?.redo) {event.preventDefault();actions.redo();return;}
  const match=Object.entries(bindings).find(([key,[code]])=>(s.bindings?.[key]||code).toLowerCase()===combo.toLowerCase());
  if(match) {event.preventDefault();keyActions[match[0]]?.();}
});
