import { clamp, playable, isHold, scenes } from './model.js';
import { interpolate, timecode } from './timeline.js';

const nonScoring=new Set(['gear','boss_ra_gear','special_note','special_hp','special_pigeon','bms_touhou_ppoint']);

export class Playtest {
  constructor(dialog,transport,project,t,icon,changed) {
    Object.assign(this,{dialog,transport,project,t,icon,changed});
    dialog.addEventListener('close',()=>{
      this.transport.pause();
      this.transport.seek(this.returnTime || 0);
      this.changed();
    });
  }
  get open() {return this.dialog.open;}

  show(start,chartPreview=false) {
    const {dialog,transport,t,icon}=this;
    this.returnTime=transport.time();
    this.demoEnd=chartPreview && this.project().previewEnd>start ? this.project().previewEnd : null;
    transport.pause();
    this.scoring=this.project().notes.filter(playable).sort((a,b)=>a.time-b.time);
    this.effects=this.project().notes.filter(note=>note.track==='effect').sort((a,b)=>a.time-b.time);
    this.resetRun(start);
    dialog.innerHTML=`
      <header class="dialog-head"><h2>${t('谱面预览','Chart preview','譜面プレビュー')}</h2><button type="button" class="icon" data-preview="close" aria-label="${t('关闭','Close','閉じる')}">${icon('close')}</button></header>
      <div class="dialog-body">
        <canvas class="preview-canvas" aria-label="${t('双轨谱面预览','Two-lane chart preview','二つのレーンをプレビュー')}"></canvas>
        <div class="preview-buttons">
          <button type="button" data-preview="play" class="primary">${icon('play')} ${t('播放','Play','再生')}</button>
          <button type="button" data-preview="restart" class="bordered">${icon('skip')} ${t('重来','Restart','やり直す')}</button>
          <label class="check-field"><input name="autoplay" type="checkbox" checked> ${t('自动击打','Auto-hit','オート')}</label>
          <span class="mono" id="preview-clock"></span>
        </div>
        <div class="preview-buttons">
          <button type="button" data-preview="air" class="preview-pad air bordered">${icon('cloud')} ${t('天空轨','Air','空中')} <kbd class="kbd">D</kbd></button>
          <button type="button" data-preview="road" class="preview-pad road bordered">${icon('layers')} ${t('地面轨','Ground','地上')} <kbd class="kbd">F</kbd></button>
          <span class="mono" id="preview-stats" aria-live="polite"></span>
        </div>
      </div>`;
    this.canvas=dialog.querySelector('canvas');
    this.ctx=this.canvas.getContext('2d');
    this.start=start;
    dialog.showModal();
    this.draw(start);
  }

  resetRun(start) {
    this.done=new Set();
    this.scoring.filter(note=>note.time<start-.1).forEach(note=>this.done.add(note.id));
    this.combo=0;this.hits=0;this.misses=0;this.feedback='';
    this.transport.seek(start);
  }
  updateButton() {
    const button=this.dialog.querySelector('[data-preview=play]');
    if(button) button.innerHTML=this.transport.playing?`${this.icon('pause')} ${this.t('暂停','Pause','一時停止')}`:`${this.icon('play')} ${this.t('播放','Play','再生')}`;
  }
  action(action) {
    if(action==='close') this.dialog.close();
    else if(action==='play') {
      if(this.transport.playing) this.transport.pause();
      else {
        if(this.demoEnd && this.transport.time()>=this.demoEnd) this.resetRun(this.start);
        this.transport.play().then(()=>{this.updateButton();this.changed();});
      }
      this.updateButton();this.changed();
    } else if(action==='restart') {
      this.resetRun(this.start);this.draw(this.start);
    } else if(['air','road'].includes(action)) this.hit(action);
  }
  hit(lane) {
    const time=this.transport.time();
    if(!this.transport.playing) return;
    const available=this.scoring.filter(note=>!this.done.has(note.id) && (note.track===lane || note.type==='double') && !nonScoring.has(note.type) && Math.abs(note.time-time)<.17);
    const note=available.sort((a,b)=>Math.abs(a.time-time)-Math.abs(b.time-time))[0];
    if(note) {
      if(note.type==='double') {
        if(this.doubleHeld?.id===note.id && this.doubleHeld.lane!==lane) this.register(note,'PERFECT');
        else this.doubleHeld={id:note.id,lane};
      } else this.register(note,Math.abs(note.time-time)<.075?'PERFECT':'GREAT');
    }
    this.flash={lane,time};
  }
  register(note,quality) {
    this.done.add(note.id);
    this.combo+=note.type==='double'?2:1;
    this.hits++;
    this.feedback=quality;
    this.feedbackTime=this.transport.time();
    this.transport.click(quality==='GREAT'?560:850);
    this.flash={lane:note.track,time:this.feedbackTime};
  }
  valueAt(type,time,defaultValue,layer=null) {
    const events=this.effects.filter(note=>note.type===type && (layer===null || note.layer===layer || note.layer===-1));
    const index=events.findLastIndex(note=>note.time<=time);
    if(index<0) return defaultValue;
    const a=events[index], b=events[index+1];
    if(typeof a.value!=='number' || !b || typeof b.value!=='number') return a.value;
    return a.value+(b.value-a.value)*interpolate(a.easing,clamp((time-a.time)/(b.time-a.time),0,1));
  }
  speedDistance(time,end,layer) {
    const markers=this.effects.filter(note=>note.type==='effect_timing' && (note.layer===layer||note.layer===-1));
    const splits=[time,...markers.filter(note=>note.time>time&&note.time<end).map(note=>note.time),end];
    let total=0;
    for(let i=0;i<splits.length-1;i++) {
      const a=splits[i],b=splits[i+1];
      const mark=markers.findLast(note=>note.time<=a+.000001);
      total+=(b-a)*(mark?.value ?? 1);
    }
    return total;
  }
  draw(time) {
    if(!this.open || !this.canvas?.clientWidth) return;
    if(this.demoEnd && time>=this.demoEnd && this.transport.playing) {
      this.transport.pause();this.updateButton();this.changed();
    }
    const auto=this.dialog.querySelector('[name=autoplay]').checked;
    if(this.transport.playing) for(const note of this.scoring) {
      if(this.done.has(note.id) || note.time>time) continue;
      if(nonScoring.has(note.type)) {this.done.add(note.id);continue;}
      if(auto) this.register(note,'PERFECT');
      else if(note.time+.17<time) {
        this.misses++;this.combo=0;this.done.add(note.id);
        this.feedback='MISS';this.feedbackTime=time;
      }
    }
    const ctx=this.ctx;
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    const dpr=Math.min(2,devicePixelRatio || 1);
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)) {
      this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const scene=this.valueAt('vfx_changescene',time,this.project().scene);
    const color=scenes.find(row=>row[0]===scene)?.[2] || '#777bff';
    const brightness=clamp(this.valueAt('vfx_bgluminance',time,1),0,2);
    const saturation=clamp(this.valueAt('vfx_grayscale',time,1),0,2);
    const hidden=this.valueAt('bms_hidebg',time,-1)>this.valueAt('bms_showbg',time,-1);
    const gradient=ctx.createLinearGradient(0,0,w,h);
    gradient.addColorStop(0,'#12121f');gradient.addColorStop(1,color+'50');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    const sceneSpeed=this.valueAt('effect_scene_timing',time,1);
    ctx.save();
    ctx.filter=`brightness(${brightness}) saturate(${saturation})`;
    if(!hidden) {
      ctx.lineWidth=1;
      for(let i=0;i<22;i++) {
        const x=((i*83-time*26*sceneSpeed)% (w+90)+w+90)%(w+90)-40;
        const y=(Math.sin(i*12.4)*.46+.5)*h;
        const size=10+i%5*6;
        ctx.strokeStyle=color+(i%3?'34':'72');ctx.strokeRect(x,y,size,size);
      }
      ctx.fillStyle=color+'13';ctx.beginPath();ctx.moveTo(w*.58,0);ctx.lineTo(w*.84,0);ctx.lineTo(w*.42,h);ctx.lineTo(w*.16,h);ctx.fill();
    }
    ctx.restore();
    const xHit=w*.16;
    const lanes={air:h*.34,road:h*.69};
    for(const [lane,y] of Object.entries(lanes)) {
      const c=lane==='air'?'#ffad82':'#b8a2ff';
      ctx.fillStyle=c+'1e';ctx.fillRect(0,y-18,w,36);
      ctx.strokeStyle=c+'77';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
      ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(xHit,y,16,0,2*Math.PI);ctx.stroke();
      if(this.flash?.lane===lane && time-this.flash.time<.13) {
        ctx.fillStyle=c+'9d';ctx.beginPath();ctx.arc(xHit,y,15,0,2*Math.PI);ctx.fill();
      }
    }
    const boss=this.project().notes.findLast(note=>note.time<=time&&['boss_ra','boss_ra_out'].includes(note.type));
    if(boss?.type==='boss_ra'&&this.valueAt('vfx_bossvisibility',time,true)) {
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(w*.91,h*.5,27,38,0,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=color+'4f';ctx.fill();
    }
    for(const note of this.scoring) {
      if(note.time>time+5 || note.end<time-.2) continue;
      if(this.done.has(note.id)&&(!isHold(note.type)||note.end<time)) continue;
      if(!this.valueAt('vfx_visibility',time,true,note.layer)) continue;
      const dx=(w-xHit)*.74*([.72,1,1.35][note.speed-1]||1);
      const x=xHit+(note.time>=time?this.speedDistance(time,note.time,note.layer):note.time-time)*dx;
      if(x>w+24) continue;
      const c=note.baseColor && /^#[a-f0-9]{6}$/i.test(note.baseColor)?note.baseColor:note.track==='air'?'#ffad82':'#b8a2ff';
      const dt=Math.max(0,note.time-time);
      const sign=note.direction==='up'?1:note.direction==='down'?-1:0;
      const y=lanes[note.track]+sign*Math.max(0,dt-.12)*h*.4;
      ctx.save();
      if(note.hsv) {
        const values=note.hsv.split('^').map(Number);
        ctx.filter=`hue-rotate(${(values[0]||0)*360}deg) saturate(${Math.max(0,1+(values[1]||0))}) brightness(${Math.max(0,1+(values[2]||0))})`;
        ctx.globalAlpha=clamp(values[3] ?? 1,0,1);
      }
      ctx.fillStyle=c;ctx.strokeStyle=c;ctx.lineWidth=3;
      if(note.nodes?.length>1) {
        ctx.beginPath();
        let first=true;
        for(let i=1;i<note.nodes.length;i++) {
          const a=note.nodes[i-1],b=note.nodes[i];
          for(let step=0;step<=12;step++) {
            const f=step/12;
            const at=a.time+(b.time-a.time)*f;
            if(at<time-.05) continue;
            const py=h*(.82-.65*(a.position+(b.position-a.position)*interpolate(b.curve,f)));
            const px=xHit+Math.max(0,at-time)*dx;
            if(first) {ctx.moveTo(px,py);first=false;} else ctx.lineTo(px,py);
          }
        }
        ctx.stroke();
      } else if(isHold(note.type)) {
        const width=Math.max(3,(note.end-Math.max(time,note.time))*dx);
        ctx.beginPath();ctx.roundRect(Math.max(x,xHit)-8,y-5,width+16,10,5);ctx.fill();
      } else {
        for(const center of note.type==='double'?[lanes.air,lanes.road]:[y]) {
          ctx.beginPath();
          if(note.type.includes('gear')) {ctx.moveTo(x,center-12);ctx.lineTo(x+12,center+10);ctx.lineTo(x-12,center+10);ctx.closePath();ctx.stroke();}
          else {ctx.arc(x,center,note.type.startsWith('large')?13:9,0,Math.PI*2);ctx.fill();}
        }
      }
      ctx.restore();
    }
    const vignette=clamp(this.valueAt('vfx_vignette',time,0),0,1);
    if(vignette) {
      const shade=ctx.createRadialGradient(w/2,h/2,h*.25,w/2,h/2,w*.63);
      shade.addColorStop(0,'transparent');shade.addColorStop(1,`rgba(0,0,0,${vignette*.95})`);
      ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
    }
    const bloom=clamp(this.valueAt('vfx_bloom',time,0),0,1);
    if(bloom) {ctx.fillStyle=`rgba(255,240,255,${bloom*.3})`;ctx.fillRect(0,0,w,h);}
    if(this.feedback && time-this.feedbackTime<.6) {
      ctx.fillStyle=this.feedback==='MISS'?'#ff96a1':'#c6ffaa';
      ctx.font='bold 16px system-ui';ctx.fillText(this.feedback,Math.max(6,xHit-34),h*.51);
    }
    const clock=this.dialog.querySelector('#preview-clock');
    if(clock) clock.textContent=timecode(time);
    const stats=this.dialog.querySelector('#preview-stats');
    const label=`${this.combo} COMBO · ${this.hits} HIT · ${this.misses} MISS`;
    if(stats && stats.textContent!==label) stats.textContent=label;
  }
}
