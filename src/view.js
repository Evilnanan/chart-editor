import { icon } from './icons.js';
import { groups, tracks, noteIcon, noteTypeNames, directions, isHold, isCurve, curves, easings, scenes, playable, isAxis, isGlobalAxis } from './model.js';
import { heartTypes } from './definitions.js';
import { timecode } from './timeline.js';

export const html = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const active = value => value ? ' active' : '';
export const button = (action,label,shape,classes='',value='',content=label) =>
  `<button type="button" class="${classes}" data-action="${action}" data-value="${html(value)}" title="${html(label)}" aria-label="${html(label)}">${shape?icon(shape,18):''}${content ? `<span>${html(content)}</span>`:''}</button>`;
export const iconButton = (action,label,shape,classes='',value='') => button(action,label,shape,'icon '+classes,value,'');
export const opt = (value,label,selected) => `<option value="${html(value)}"${String(selected)===String(value)?' selected':''}>${html(label)}</option>`;
export const input = (name,value,type='text',attributes='') => `<input name="${name}" type="${type}" value="${html(value)}" ${attributes}>`;
export const select = (name,values,current,attributes='') => `<select name="${name}" ${attributes}>${values.map(([value,label])=>opt(value,label,current)).join('')}</select>`;
export const field = (label,content,wide=false) => `<label class="field${wide?' wide':''}"><span>${html(label)}</span>${content}</label>`;
export const checkbox = (name,label,value,attributes='') => `<label class="check-field"><input name="${name}" type="checkbox" ${value?'checked':''} ${attributes}>${html(label)}</label>`;

export function shell() {
  return `
  <header class="top" id="top"></header>
  <main class="workspace" id="workspace" data-mobile="editor">
    <aside class="sidebar" id="sidebar"></aside>
    <section class="center" id="center">
      <header class="project-head" id="project-head"></header>
      <section class="editor" id="editor">
        <div class="toolbar" id="toolbar"></div>
        <div class="timeline">
          <div class="lane-labels" id="lane-labels"></div>
          <div class="canvas-wrap" id="canvas-wrap"><canvas id="timeline-canvas" tabindex="0"></canvas></div>
        </div>
        <div class="scrub" id="scrub" role="slider" aria-orientation="horizontal" aria-valuemin="0" tabindex="0"><div class="scrub-thumb"></div></div>
        <div class="transport" id="transport"></div>
        <div id="audio-levels" class="audio-levels" hidden></div>
        <div class="board-head" id="board-head" hidden></div>
      </section>
      <section class="palette" id="palette"></section>
      <p class="editor-hint" id="editor-hint"></p>
    </section>
    <aside class="inspector" id="inspector"></aside>
  </main>
  <footer class="statusbar" id="statusbar"></footer>
  <nav class="mobile-nav" id="mobile-nav"></nav>
  <dialog id="dialog"></dialog>
  <dialog id="preview" class="playtest"></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
  <input id="file-input" type="file" multiple hidden>
  <input id="folder-input" type="file" webkitdirectory multiple hidden>
  <input id="audio-input" type="file" accept="audio/*,.ogg,.wav,.mp3,.flac,.m4a" hidden>
  <input id="cover-input" type="file" accept="image/*" hidden>`;
}

export function renderTop(t,s) {
  return `<div class="topgroup">
    <div class="brand"><span class="brand-mark">${icon('logo',24)}</span><div>
      <div class="brand-name">${t('谱面工作室','Chart Studio','譜面スタジオ')}</div>
      <div class="brand-sub">Muse Dash Chart Editor</div>
    </div></div>
    <span class="top-sep"></span>
    <span class="save-state" id="save-state">${icon(s.saved?'check':'clock',14)} ${s.saved?t('已保存到此设备','Saved on this device','端末に保存済み'):t('正在保存','Saving','保存中')}</span>
  </div><div class="top-actions">
    ${button('new',t('新建谱面','New chart','新しい譜面'),'plus','bordered','',t('新建','New','新規'))}
    ${button('open',t('打开','Open','開く'),'folder','bordered')}
    ${button('export',t('保存 / 导出','Save / Export','保存・書き出し'),'download','primary')}
    ${iconButton('settings',t('设置','Settings','設定'),'sliders','subtle mobile-hide')}
  </div>`;
}

export function renderSidebar(t,s,p,cover) {
  const actions=[
    ['metadata',t('谱面信息','Chart info','譜面情報'),'file'],
    ['grid-settings',t('格线与 BPM','Grid & BPM','グリッドと BPM'),'grid'],
    ['audio',t('音频与封面','Audio & cover','音源とカバー'),'headphones'],
    ['board',t('故事板','Storyboard','ストーリーボード'),'sparkles'],
    ['filter',t('显示与选择过滤','View & selection filters','表示・選択フィルター'),'filter'],
    ['check',t('设计检查','Validate chart','譜面チェック'),'check'],
    ['convert',t('格式转换','Convert formats','形式変換'),'convert'],
  ];
  return `
    <section class="side-section"><div class="side-caption">${t('当前项目','PROJECT','プロジェクト')}</div>
      <button class="project-tile" type="button" data-action="metadata">
        <span class="project-art">${icon('music',16)}${cover ? `<img src="${html(cover)}" alt="">` : ''}</span>
        <span class="tile-text"><strong>${html(p.name)}</strong><small>${html(p.format==='bms'?'BMS':p.format==='epk'?'Euterpe':p.format==='mdm'?'CustomAlbums':'CustomPlay')}</small></span>
        ${icon('chevron',13)}
      </button>
    </section>
    <section class="side-section"><div class="side-caption">${t('编辑工具','EDITOR','編集ツール')}</div>
      ${actions.map(([action,label,shape])=>button(action,label,shape,'side-button'+(action==='board'&&s.board?' current':''))).join('')}
    </section>
    <section class="side-section"><div class="side-caption">${t('谱面层级','LAYERS','レイヤー')}
      ${iconButton('layers',t('管理层级','Manage layers','レイヤー管理'),'plus','small')}
    </div>${p.layers.map(layer=>`
      <div class="layer-row${layer.id===s.layer?' current':''}">
        <button type="button" class="side-button" data-action="set-layer" data-value="${layer.id}"><span class="layer-dot"></span><span>${html(layer.name)}</span></button>
        ${iconButton('toggle-layer',layer.visible?t('隐藏层级','Hide layer','非表示'):t('显示层级','Show layer','表示'),layer.visible?'eye':'eyeOff','small',layer.id)}
      </div>`).join('')}</section>
    <section class="side-bottom">
      ${button('new',t('新建谱面','New chart','新しい譜面'),'plus','side-button')}
      ${button('settings',t('设置','Settings','設定'),'sliders','side-button')}
      ${button('help',t('操作指南','Help & shortcuts','操作ガイド'),'help','side-button')}
    </section>`;
}

export function renderHeader(t,s,p) {
  return `<div class="heading-main">
    <p class="eyebrow">${p.demo?t('示例谱面','DEMO CHART','サンプル譜面'):t('谱面编辑','CHART EDITOR','譜面編集')}</p>
    <h1>${html(p.name)}</h1>
    <div class="project-meta">
      <span class="badge">${html(p.difficulty)} ${p.level?`· ${html(p.level)}`:''}</span>
      <span class="subsep">·</span>${button('grid-settings',t('格线与 BPM','Grid & BPM','グリッドと BPM'),null,'meta-bpm','',p.bpm+' BPM')}
      <span class="subsep">·</span><span>${html(p.numerator)}/${html(p.denominator)}</span>
      ${p.artist?`<span class="subsep">·</span><span>${html(p.artist)}</span>`:''}
    </div>
  </div>
  <div class="project-tools">
    ${button('preview',t('预览','Preview','プレビュー'),'play','bordered')}
    ${iconButton('filter',t('显示与选择过滤','Filters','フィルター'),'filter','bordered optional')}
    ${iconButton('help',t('操作指南','Help','ヘルプ'),'help','bordered optional')}
  </div>`;
}

export function renderToolbar(t,s) {
  const modes=[['select',t('选择','Select','選択'),'cursor'],['draw',t('绘制','Draw','描画'),'pencil'],['pan',t('平移','Pan','移動'),'hand'],['erase',t('擦除','Erase','消す'),'eraser']];
  const options=[1,2,3,4,5,6,8,12,16,24,32,48,64,96,192];
  if(!options.includes(s.division)) options.push(s.division);
  return `<div class="tool-group">
    ${iconButton('undo',t('撤销','Undo','元に戻す'),'undo','subtle')}
    ${iconButton('redo',t('重做','Redo','やり直す'),'redo','subtle')}
  </div><div class="tool-group">
    ${modes.map(([mode,label,shape])=>button('mode',label,shape,'tool-mode'+active(s.mode===mode),mode,label)).join('')}
  </div><div class="tool-group">
    ${iconButton('snap',t('吸附格线','Grid snap','グリッド吸着'),'magnet',active(s.snap))}
    ${select('division',options.map(value=>[value,'1/'+value]),s.division,`aria-label="${t('格线细分','Grid division','グリッド分割')}"`)}
    ${iconButton('multi',t('多选','Multi-select','複数選択'),'layers',active(s.multi))}
    ${iconButton('follow',t('跟随播放头','Follow playhead','再生ヘッド追従'),'link',active(s.follow))}
  </div>`;
}

export function renderTransport(t,s,position,duration,playing) {
  return `<div class="transport-group">
    ${iconButton('rewind',t('回到开头','Go to start','先頭へ'),'skip','subtle')}
    ${iconButton('play',playing?t('暂停','Pause','一時停止'):t('播放','Play','再生'),playing?'pause':'play','primary play')}
    <span class="clock mono" id="clock">${timecode(position)}<small>/ ${timecode(duration,0)}</small></span>
    ${iconButton('loop',t('循环播放','Loop playback','ループ再生'),'loop',active(s.loopEnabled))}
  </div>
  <div class="transport-group">
    ${muteButton(t,s)}
    <input class="volume-slider" type="range" name="volume" min="0" max="1" step=".01" value="${s.volume}" aria-label="${t('播放音量','Playback volume','再生音量')}">
    ${iconButton('audio-levels',t('波形与音量','Waveform and volume','波形と音量'),'sliders','subtle level-toggle'+active(s.audioLevels))}
    ${select('rate',[.25,.5,.75,1,1.25,1.5,2].map(rate=>[rate,rate+'×']),s.rate,`aria-label="${t('播放速度','Playback speed','再生速度')}"`)}
  </div>
  <div class="zoom-group">
    ${iconButton('zoom-out',t('缩小时间轴','Zoom out','縮小'),'minus','subtle')}
    <span id="zoom-val" class="mono zoom-val"></span>
    ${iconButton('zoom-in',t('放大时间轴','Zoom in','拡大'),'plus','subtle')}
  </div>`;
}

export const muteLabel=(t,s)=>s.volume?t('静音','Mute','ミュート'):t('取消静音','Unmute','ミュート解除');
const muteButton=(t,s)=>iconButton('mute',muteLabel(t,s),'volume','subtle volume-icon'+active(!s.volume));

export function renderAudioLevels(t,s) {
  const mode=field(t('波形显示','Waveform view','波形表示'),select('waveformMode',[
    ['rhythm',t('节奏增强 · 金色起音','Rhythm · Gold onset markers','リズム強調 · 金色のアタック')],
    ['amplitude',t('原始振幅','Amplitude','振幅')],
  ],s.waveformMode,'class="waveform-mode"'));
  const levels=[
    ['volume',t('播放音量','Playback volume','再生音量'),0,1,.01],
    ['waveformGain',t('波形增益','Waveform gain','波形ゲイン'),.25,4,.05],
  ].map(([name,label,min,max,step])=>`<label class="field audio-level"><span>${html(label)}
    <output class="mono" data-level-value="${name}">${Math.round(s[name]*100)}%</output></span>
    ${input(name,s[name],'range',`min="${min}" max="${max}" step="${step}" aria-label="${html(label)}" aria-valuetext="${Math.round(s[name]*100)}%"`)}
  </label>`).join('');
  return mode+levels;
}

export function renderPalette(t,s) {
  const tabs={
    normal:[t('常规','Notes','ノーツ'),'circle'],action:[t('动作','Actions','アクション'),'activity'],
    effect:[t('特效','Effects','エフェクト'),'sparkles'],tempo:[t('节拍','Tempo','テンポ'),'metronome'],
    mdcp:['MDCP','curve'],bms:['BMS','file'],
  };
  return `<nav class="palette-tabs" aria-label="${t('音符分类','Note categories','ノーツ分類')}">
    ${Object.entries(tabs).map(([group,[label,shape]])=>button('category',label,shape,'small'+active(s.category===group),group)).join('')}
  </nav>${s.mode==='draw' ? `<div class="placement-controls">
    ${s.category==='mdcp'?field(t('线型','Curve','カーブ'),select('placement-curve',curves,s.curveType)):field(t('入场','Entrance','登場'),select('placement-direction',stageNames(t).filter(([dir])=>directions(s.noteType).includes(dir)),directions(s.noteType).includes(s.placementDirection)?s.placementDirection:directions(s.noteType)[0]))}
    ${field(t('流速','Speed','流速'),select('placement-speed',stages(t),s.placementSpeed))}
  </div>`:''}<div class="palette-grid">
    ${groups[s.category].map(type=>button('note-type',noteTypeNames(type,s.lang),noteIcon(type),'note-option'+active(s.noteType===type),type)).join('')}
  </div>`;
}

export function renderBoard(t,s) {
  return `<h2>${icon('sparkles',16)} ${t('故事板','Storyboard','ストーリーボード')}</h2>
    <div class="board-actions">
      ${button('axis-add',t('添加特效轴','Add effect lane','レーン追加'),'plus','small bordered')}
      ${iconButton('board',t('收起故事板','Hide storyboard','閉じる'),'close','small')}
    </div>`;
}

export const stageNames = t => [
  ['normal',t('平行','Straight','水平')],['up',t('向上','Up','上')],['down',t('向下','Down','下')],
];
export const stages = t => [
  [1,t('1 · 低','1 · Low','1 · 低')],[2,t('2 · 中','2 · Medium','2 · 中')],[3,t('3 · 高','3 · High','3 · 高')],
];

export function renderInspector(t,s,p,items,audioLabel,coverLabel) {
  const item=items[0];
  const count=items.length;
  const tempo=item?.type==='preset_beatbpm' && p.tempos.some(tempo=>tempo.id===item.id);
  const allPlayable=items.every(playable);
  const isEffect=item?.track==='effect';
  const idAttr='data-inspect';
  const textAttr='data-inspect step="any"';
  const pasteControl=s.clipboard.length?button('paste',t('粘贴到播放头','Paste at playhead','再生ヘッドに貼る'),'copy','bordered small'):'';
  const rows=item ? `
    <div class="selection-heading"><span class="note-bubble">${icon(noteIcon(item.type),18)}</span><strong>${count===1?html(noteTypeNames(item.type,s.lang)):t(`已选中 ${count} 个对象`,`${count} selected`,`${count} 個選択`)}</strong></div>
    <div class="inspect-fields">
      ${tempo ? field('BPM',input('bpm',item.bpm,'number',textAttr+' min="1" max="9999"')) :
      field(t('类型','Type','種類'),select('type',[...new Set([item.type,...(allPlayable ? Object.values(groups).flat().filter(type=>!isAxis(type) && !['preset_beatbpm','effect_timing','effect_scene_timing'].includes(type)) : groups[item.track==='action'?'action':'effect'])])].map(type=>[type,noteTypeNames(type,s.lang)]),item.type,idAttr),true)}
      ${field(t('时间（秒）','Time (s)','時間（秒）'),input('time',item.time,'number',textAttr))}
      ${tempo ? field(t('每小节拍数','Beats per bar','拍子'),input('numerator',item.numerator,'number',idAttr+' min="1" max="64"')) : ''}
      ${tempo ? field(t('拍值','Beat unit','音価'),select('denominator',[1,2,4,8,16,32].map(n=>[n,'1/'+n]),item.denominator,idAttr)) : ''}
      ${!tempo && allPlayable ? field(t('轨道','Track','レーン'),select('track',[['air',t('天空轨','Air','空中')],['road',t('地面轨','Ground','地上')]],item.track,idAttr)) : ''}
      ${!tempo && !isGlobalAxis(item.type) && p.layers.length>1 ? field(t('层级','Layer','レイヤー'),select('layer',p.layers.map(layer=>[layer.id,layer.name]),item.layer,idAttr),!allPlayable) : ''}
      ${!tempo && allPlayable ? field(t('入场','Entrance','登場'),select('direction',stageNames(t).filter(([value])=>directions(item.type).includes(value)),item.direction,idAttr)) : ''}
      ${!tempo && allPlayable ? field(t('流速','Scroll speed','流速'),select('speed',stages(t),item.speed,idAttr)) : ''}
      ${!tempo && isHold(item.type) && item.type!=='long_short' ? field(t('结束（秒）','End (s)','終点（秒）'),input('end',item.end,'number',textAttr),true) : ''}
      ${!tempo && isEffect ? effectField(t,item,idAttr,textAttr) : ''}
      ${allPlayable && heartTypes.includes(item.type) ? checkbox('heart',t('附加红心','Attach heart','ハートを付ける'),item.heart,idAttr) : ''}
    </div>
    ${count===1 && isCurve(item) && item.nodes ? curveDetails(t,item,s) : ''}
    ${count===1 && allPlayable ? colorDetails(t,item) : ''}
    <div class="inspect-actions">
      ${button('copy',t('复制','Copy','コピー'),'copy','bordered small')}
      ${p.layers.length>1 ? button('copy-layer',t('复制到当前层','Copy onto current layer','現在のレイヤーにコピー'),'layers','bordered small'):''}
      ${pasteControl}
      ${allPlayable ? button('mirror',t('镜像','Mirror','反転'),'mirror','bordered small') : ''}
      ${button('delete',t('删除','Delete','削除'),'trash','danger small')}
    </div>` : `<div class="ins-empty"><span class="empty-icon">${icon('cursor',21)}</span>
      <strong>${t('未选择对象','Nothing selected','未選択')}</strong>
      <p>${t('点选音符或拖出选区以编辑属性。','Select a note or drag a box to edit its properties.','ノーツを選択してプロパティを編集。')}</p>${pasteControl}</div>`;
  const combo=p.notes.filter(note=>playable(note) && !['gear','boss_ra_gear','special_note','special_hp','bms_touhou_ppoint'].includes(note.type)).reduce((sum,note)=>sum+(note.type==='double'||note.type.startsWith('long')||isCurve(note)?2:1),0);
  const metrics=[
    [t('音符数','Objects','ノーツ数'),p.notes.length],[t('连击','Combo','コンボ'),combo],
    [t('齿轮','Gears','ギア'),p.notes.filter(note=>note.type.includes('gear')).length],
    [t('收集物','Collectibles','収集物'),p.notes.filter(note=>['special_note','special_hp','bms_touhou_ppoint'].includes(note.type)).length],
    [t('时长','Length','長さ'),timecode(p.duration,0)],
  ];
  return `<header class="inspector-head"><h2>${icon('sliders',17)} ${t('属性检查器','Inspector','インスペクター')}</h2>
      ${iconButton('edit-list',t('对象列表','Object list','オブジェクト一覧'),'dots','small subtle')}
    </header>
    <section class="inspect-section">${rows}</section>
    <section class="inspect-section"><h3 class="eyebrow">${t('谱面统计','CHART STATISTICS','譜面統計')}</h3>
      <div class="metrics">${metrics.map(([label,value])=>`<div class="metric"><span>${html(label)}</span><strong class="mono">${html(value)}</strong></div>`).join('')}</div>
    </section>
    <section class="inspect-section"><h3 class="eyebrow">${t('项目资源','ASSETS','素材')}</h3>
      <div class="asset-line">${icon('music',15)}<span>${html(audioLabel || t('未选择音频','No audio selected','音源なし'))}</span>
        ${iconButton('choose-audio',t('更换音频','Choose audio','音源を選択'),'plus','small subtle')}</div>
      <div class="asset-line">${icon('file',15)}<span>${html(coverLabel || t('未选择封面','No cover selected','カバーなし'))}</span>
        ${iconButton('choose-cover',t('更换封面','Choose cover','カバーを選択'),'plus','small subtle')}</div>
    </section>`;
}

function effectField(t,item,idAttr,textAttr) {
  if(item.type==='vfx_changescene') return field(t('场景','Scene','背景'),select('value',scenes.map(([id,label])=>[id,label]),item.value,idAttr),true);
  if(['vfx_visibility','vfx_bossvisibility'].includes(item.type)) return field(t('可见性','Visibility','表示'),select('value',[[true,t('显示','Show','表示')],[false,t('隐藏','Hide','非表示')]],item.value,idAttr),true);
  if(item.type.startsWith('bms_') && item.type!=='bms_spdctrl') return '';
  const range=({vfx_vignette:' min="0" max="1"',vfx_bgluminance:' min="0" max="1"',vfx_bloom:' min="0"',vfx_grayscale:' min="-100" max="100"'})[item.type] || '';
  return field(t('数值','Value','値'),input('value',item.value,'number',textAttr+range),true)
    +(isAxis(item.type)&&!item.type.startsWith('effect_')?field(t('关键帧曲线','Keyframe easing','キーフレーム'),select('easing',easings,item.easing,idAttr),true):'');
}

function curveDetails(t,item,s) {
  return `<details class="inspect-detail" ${s.selectedNode?.id===item.id?'open':''}><summary>${t('曲线节点','Curve nodes','カーブノード')} · ${item.nodes.length}</summary>
    <div class="node-list">
      ${item.nodes.map(({time,position,curve},index)=>`<div class="node-row">
        ${input('node-time',time,'number',`step="any" data-node="${index}" aria-label="${t('节点时间','Node time','ノード時間')}"`)}
        ${input('node-position',position,'number',`step="any" min="-1" max="2" data-node="${index}" aria-label="${t('节点位置','Node position','ノード位置')}"`)}
        ${select('node-curve',curves,curve,`data-node="${index}" aria-label="${t('线型','Curve type','種類')}"`)}
        ${iconButton('node-delete',t('删除节点','Delete node','ノード削除'),'close','small danger',index)}
      </div>`).join('')}
    </div>
    ${button('node-add',t('添加节点','Add node','ノードを追加'),'plus','small bordered')}
    ${button('curve-extend',t('续写','Extend curve','カーブを延長'),'curve','small bordered')}
  </details>`;
}

function colorDetails(t,item) {
  return `<details class="inspect-detail"><summary>${t('颜色与渐变','Color & gradient','色・グラデーション')}</summary>
    <div class="inspect-fields">
      ${field(t('基色','Base color','基本色'),input('baseColor',item.baseColor || '', 'text','data-inspect placeholder="#FFAA88"'),true)}
      ${field(t('色相 / 饱和度 / 明度','Hue / saturation / value','色相・彩度・明度'),input('hsv',item.hsv || '', 'text','data-inspect placeholder="0^0^0"'),true)}
      ${isHold(item.type)?field(t('渐变起点','Gradient start','グラデーション始点'),input('gradientStart',item.gradientStart || '', 'text','data-inspect placeholder="0^0^0^1"'),true):''}
      ${isHold(item.type)?field(t('渐变末端','Gradient end','グラデーション終点'),input('gradient',item.gradient || '', 'text','data-inspect placeholder="0^0^0^1"'),true):''}
      ${isHold(item.type)?checkbox('stayTexture',t('保持长按材质','Keep hold texture','長押しテクスチャを維持'),item.stayTexture,'data-inspect'):''}
    </div>
  </details>`;
}
