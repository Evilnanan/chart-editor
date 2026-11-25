import { clamp, isCurve, isHold, groupOf, gridPoints, noteIcon, noteTypeNames, tracks } from './model.js';
import { icon } from './icons.js';

export function timecode(value, precision=3) {
  const time=Math.max(0,value);
  const seconds=Math.floor(time);
  const fraction=String(Math.floor((time-seconds+1e-8)*1000)).padStart(3,'0');
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${precision ? '.'+fraction.slice(0,precision) : ''}`;
}

function pill(ctx,x,y,width,height,radius) {
  ctx.beginPath();
  ctx.roundRect(x,y,width,height,Math.min(radius,width/2,height/2));
}

export function interpolate(kind,t) {
  if (kind==='Bezier' || kind==='InOutCubic') return t*t*(3-2*t);
  if (kind==='EaseIn' || kind==='InCubic') return t*t*t;
  if (kind==='EaseOut' || kind==='OutCubic') return 1-(1-t)**3;
  if (kind==='InQuad') return t*t;
  if (kind==='OutQuad') return 1-(1-t)**2;
  if (kind==='InOutQuad') return t<.5 ? 2*t*t : 1-2*(1-t)**2;
  if (kind==='InSine') return 1-Math.cos(t*Math.PI/2);
  if (kind==='OutSine') return Math.sin(t*Math.PI/2);
  if (kind==='InOutSine') return (1-Math.cos(t*Math.PI))/2;
  if (kind==='NULL') return 0;
  return t;
}

export class Timeline {
  constructor(host,labels,scrub,api) {
    this.host=host;
    this.labels=labels;
    this.scrub=scrub;
    this.api=api;
    this.canvas=host.querySelector('canvas');
    this.ctx=this.canvas.getContext('2d');
    this.pointers=new Map();
    this.hits=[];
    this.start=0;
    this.scale=104;
    this.resize=new ResizeObserver(()=>{this.layout();this.draw();});
    this.resize.observe(host);
    for (const name of ['pointerdown','pointermove','pointerup','pointercancel']) this.canvas.addEventListener(name,event=>this[name](event));
    this.canvas.addEventListener('contextmenu',event=>{event.preventDefault();if (this.api.state.curveDraft) this.api.finishCurve();});
    this.canvas.addEventListener('wheel',event=>this.wheel(event),{passive:false});
    this.canvas.addEventListener('pointerleave',()=>{this.hover=null;this.draw();});
    const seekScroll=event=>{
      const bounds=this.scrub.getBoundingClientRect();
      this.setStart((event.clientX-bounds.left)/bounds.width*this.api.project().duration-this.width/this.scale/2);
      this.draw();
    };
    this.scrub.addEventListener('pointerdown',event=>{this.scrub.setPointerCapture(event.pointerId);seekScroll(event);});
    this.scrub.addEventListener('pointermove',event=>{if(this.scrub.hasPointerCapture(event.pointerId)) seekScroll(event);});
    this.scrub.addEventListener('keydown',event=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      this.setStart(event.key==='Home'?0:event.key==='End'?this.api.project().duration:this.start+(event.key==='ArrowLeft'?-1:1)*this.width/this.scale*.3);
      this.draw();
    });
  }

  layout() {
    const mobile=matchMedia('(max-width:680px)').matches;
    const width=this.host.clientWidth;
    if (!width) return;
    this.width=width;
    this.dpr=Math.min(2,devicePixelRatio || 1);
    const translate=this.api.t;
    const visible=tracks.filter(track=>!this.api.state.hiddenTracks.has(track.id));
    const axes=this.api.state.board ? this.api.project().axes.filter(axis=>axis.layer===this.api.state.layer || axis.layer===-1) : [];
    const wave=this.api.state.waveform;
    const spec=[
      {id:'ruler',name:'',height:mobile?28:33},
      ...(wave ? [{id:'wave',name:translate('波形','Waveform','波形'),icon:'activity',height:mobile?49:65,color:'#9994bb'}] : []),
      ...visible.map(track=>({...track,name:translate(track.name,track.en,track.ja),height:mobile ? (['air','road'].includes(track.id)?66:34) : (['air','road'].includes(track.id)?86:42)})),
      ...axes.map(axis=>({id:'axis:'+axis.id,axis,name:noteTypeNames(axis.type,this.api.state.lang),color:'#86ced3',height:46,icon:'curve'})),
    ];
    let y=0;
    this.rows=spec.map(row=>{const result={...row,y};y+=row.height;return result;});
    this.height=y;
    const labelSignature=JSON.stringify(spec);
    if (this.labelSignature!==labelSignature) {
      this.labels.replaceChildren(...this.rows.map(row=>{
        const element=document.createElement('div');
        element.className='lane-label '+(row.axis?'axis-label':row.id);
        element.style.height=row.height+'px';
        if(row.color) element.style.setProperty('--lane',row.color);
        if(row.icon) {
          const symbol=document.createElement('span');
          symbol.className='lane-icon';
          symbol.innerHTML=icon(row.icon,15);
          element.append(symbol);
        }
        const name=document.createElement('span');
        name.textContent=row.name || translate('小节','BAR','小節');
        element.append(name);
        if(row.axis) {
          const button=document.createElement('button');
          button.className='icon small';
          button.dataset.action='axis-menu';
          button.dataset.value=row.axis.id;
          button.title=translate('编辑特效轴','Edit effect lane','レーン編集');
          button.setAttribute('aria-label',button.title);
          button.innerHTML=icon('dots',15);
          element.append(button);
        }
        return element;
      }));
      this.labelSignature=labelSignature;
    }
    if (this.canvas.width!==Math.round(width*this.dpr) || this.canvas.height!==Math.round(y*this.dpr)) {
      this.canvas.width=Math.round(width*this.dpr);
      this.canvas.height=Math.round(y*this.dpr);
      this.canvas.style.height=y+'px';
    }
    this.setStart(this.start);
  }

  setStart(time) {
    this.start=clamp(time,0,Math.max(0,this.api.project().duration-(this.width || 0)/this.scale*.6));
  }
  x(time) {return (time-this.start)*this.scale;}
  time(x) {return this.start+x/this.scale;}
  center(time,fraction=.36) {this.setStart(time-this.width/this.scale*fraction);}
  zoom(multiplier,x=this.width*.5) {
    const anchor=this.time(x);
    this.scale=clamp(this.scale*multiplier,13,920);
    this.setStart(anchor-x/this.scale);
    this.api.updateZoom();
    this.draw();
  }

  draw() {
    if (!this.width || !this.height) return;
    const {ctx,width,height,rows,dpr}=this;
    const project=this.api.project();
    const state=this.api.state;
    const end=this.time(width);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    for (const row of rows) {
      ctx.fillStyle=({ruler:'#21212a',wave:'#1e1e2a',air:'#211e26',road:'#1e1d2a'})[row.id] || (row.axis?'#19262d':'#1b1b24');
      ctx.fillRect(0,row.y,width,row.height);
    }
    const points=gridPoints(project,this.start,end,state.division,7/this.scale);
    const ticks=gridPoints(project,this.start,end,1,55/this.scale);
    if (state.grid) {
      for (const point of points) {
        const x=Math.round(this.x(point.time))+.5;
        ctx.strokeStyle=point.kind==='bar'?'#424252':point.kind==='beat'?'#343444':'#2b2937';
        ctx.beginPath();ctx.moveTo(x,rows[0].height);ctx.lineTo(x,height);ctx.stroke();
      }
    }
    ctx.font='11px "SFMono-Regular", Consolas, monospace';
    for (const {time,kind,measure} of ticks) {
      if (kind==='sub') continue;
      const x=Math.round(this.x(time))+.5;
      const mark=kind==='bar';
      ctx.strokeStyle=mark?'#686879':'#404050';
      ctx.beginPath();ctx.moveTo(x,rows[0].height-(mark?10:5));ctx.lineTo(x,rows[0].height);ctx.stroke();
      if(mark && measure>0) {
        ctx.fillStyle='#cccbd7';
        ctx.fillText(String(measure).padStart(2,'0'),x+5,13);
        ctx.fillStyle='#8f8fa6';
        ctx.font='9px "SFMono-Regular", Consolas, monospace';
        ctx.fillText(timecode(time,1),x+5,25);
        ctx.font='11px "SFMono-Regular", Consolas, monospace';
      }
    }
    const wave=rows.find(row=>row.id==='wave');
    if(wave) this.drawWave(wave);
    for (const row of rows) {
      ctx.strokeStyle='#31313d';
      ctx.beginPath();ctx.moveTo(0,row.y+row.height-.5);ctx.lineTo(width,row.y+row.height-.5);ctx.stroke();
    }
    if (state.loopEnabled) {
      const x=this.x(state.loopStart), right=this.x(state.loopEnd);
      ctx.fillStyle='#bafa8d0a';ctx.fillRect(x,0,right-x,height);
      for(const edge of [x,right]) {ctx.fillStyle='#bafa8d75';ctx.fillRect(edge,0,1,height);}
    }
    this.hits=[];
    const notes=this.api.visibleNotes().sort((a,b)=>(a.layer===state.layer)-(b.layer===state.layer));
    for (const note of notes) {
      if (note.end<this.start-.2 || note.time>end+.2) continue;
      const matchingAxis=rows.find(row=>row.axis?.id===note.axisId);
      const row=matchingAxis || rows.find(row=>row.id===note.track);
      if (!row) continue;
      this.drawNote(note,row);
      if(note.type==='double') {
        const air=rows.find(row=>row.id==='air');
        if(air) this.drawNote(note,air);
      }
    }
    for (const tempo of project.tempos) {
      const row=rows.find(row=>row.id==='tempo');
      if(!row || tempo.time<this.start-.15 || tempo.time>end+.15) continue;
      const item={...tempo,type:'preset_beatbpm',track:'tempo',end:tempo.time};
      this.drawNote(item,row);
      const x=this.x(tempo.time);
      ctx.fillStyle='#e7d591';ctx.font='10px monospace';
      ctx.fillText(`${tempo.bpm} · ${tempo.numerator}/${tempo.denominator}`,x+13,row.y+row.height/2+3);
    }
    if(state.mode==='draw' && isCurve({type:state.noteType}) && state.grid) {
      const step=Math.max(1,Math.ceil(state.curveDivision/24));
      ctx.strokeStyle='#77709243';
      ctx.setLineDash([3,6]);
      for(let i=0;i<=state.curveDivision;i+=step) {
        const y=this.curveY(i/state.curveDivision);
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if(state.curveDraft) this.drawCurve(state.curveDraft,true);
    if(this.drag?.kind==='hold' && this.drag.moved) {
      const row=rows.find(row=>row.id===this.drag.row);
      if(row) {
        const a=this.x(this.drag.time),b=this.x(this.drag.end);
        ctx.fillStyle='#bafa8d48';pill(ctx,Math.min(a,b)-6,row.y+row.height*.5-5,Math.abs(b-a)+12,10,6);ctx.fill();
      }
    }
    if(this.drag?.kind==='selection' && this.drag.moved) {
      const {x,y,last}=this.drag;
      ctx.fillStyle='#bafa8d20';ctx.strokeStyle='#bafa8d9c';
      ctx.fillRect(x,y,last.x-x,last.y-y);ctx.strokeRect(x,y,last.x-x,last.y-y);
    }
    if(this.hover && state.mode==='draw' && !this.drag && this.hover.row && !['ruler','wave'].includes(this.hover.row.id)) {
      const x=this.x(this.api.snap(this.time(this.hover.x)));
      ctx.fillStyle='#bafa8d5e';ctx.fillRect(x,this.hover.row.y,1,this.hover.row.height);
    }
    if(state.indicator) {
      const x=this.x(this.api.currentTime());
      if(x>=-3 && x<=width+3) {
        ctx.fillStyle='#bafa8d';
        ctx.fillRect(Math.round(x),0,1.5,height);
        ctx.beginPath();ctx.moveTo(x-5,0);ctx.lineTo(x+5,0);ctx.lineTo(x+5,7);ctx.lineTo(x,13);ctx.lineTo(x-5,7);ctx.fill();
      }
    }
    this.updateScrub();
  }

  drawWave(row) {
    const {ctx,width}=this;
    const peaks=this.api.peaks();
    const mid=row.y+row.height/2;
    ctx.strokeStyle='#424054';
    ctx.beginPath();ctx.moveTo(0,mid+.5);ctx.lineTo(width,mid+.5);ctx.stroke();
    if(!peaks) return;
    const duration=this.api.audioDuration();
    const gradient=ctx.createLinearGradient(0,row.y,0,row.y+row.height);
    gradient.addColorStop(0,'#9390c6');gradient.addColorStop(.5,'#525077');gradient.addColorStop(1,'#9390c6');
    ctx.fillStyle=gradient;
    for(let x=0;x<width;x+=2) {
      const time=this.time(x);
      if(time>=duration) break;
      const first=Math.floor(time/duration*peaks.length);
      const last=Math.floor(this.time(x+2)/duration*peaks.length);
      let value=0;
      for(let i=first;i<=last;i++) value=Math.max(value,peaks[i] || 0);
      const h=Math.max(1,Math.min(row.height*.46,value*row.height*1.38));
      ctx.fillRect(x,mid-h,1.25,h*2);
    }
  }

  drawNote(note,row) {
    if(isCurve(note) && note.nodes?.length) {this.drawCurve(note,false);return;}
    const {ctx}=this;
    const state=this.api.state;
    const selected=state.selected.has(note.id);
    const x=this.x(note.time),y=row.y+row.height*.5;
    const end=this.x(note.end);
    const isLong=isHold(note.type) && end-x>7;
    const color=row.color || '#b9b6cf';
    const layerAlpha=note.layer===undefined || note.layer===state.layer || note.layer===-1 ? 1 : state.layerOpacity;
    const alpha=layerAlpha*(state.mode==='draw' && state.category!==groupOf(note.type)?state.otherOpacity:1);
    const baseRadius=note.type.startsWith('mid')?7:note.type.startsWith('large')?9:6;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.strokeStyle=selected?'#e1ffcc':color;
    ctx.fillStyle=color;
    ctx.lineWidth=selected?2:1.4;
    if(isLong) {
      const w=Math.max(12,end-x+12);
      pill(ctx,x-6,y-4,w,8,5);ctx.fill();
      ctx.fillStyle='#15151c50';pill(ctx,x,y-1.5,Math.max(1,end-x),3,1);ctx.fill();
      ctx.fillStyle=color;
      for(const edge of [x,end]) {ctx.beginPath();ctx.arc(edge,y,5,0,Math.PI*2);ctx.fill();if(selected)ctx.stroke();}
    } else if(noteIcon(note.type)==='triangle') {
      ctx.beginPath();ctx.moveTo(x,y-7);ctx.lineTo(x+7,y+6);ctx.lineTo(x-7,y+6);ctx.closePath();ctx.stroke();
    } else if(noteIcon(note.type)==='diamond' || note.track==='effect' || note.track==='tempo' || note.track==='action' || note.type==='special_note') {
      ctx.beginPath();ctx.moveTo(x,y-7);ctx.lineTo(x+7,y);ctx.lineTo(x,y+7);ctx.lineTo(x-7,y);ctx.closePath();
      if(note.type!=='special_note') ctx.fill();ctx.stroke();
    } else {
      ctx.beginPath();ctx.arc(x,y,baseRadius,0,Math.PI*2);ctx.fill();
      if(selected) ctx.stroke();
      ctx.fillStyle='#15151c55';ctx.beginPath();ctx.arc(x,y,1.7,0,Math.PI*2);ctx.fill();
    }
    if(note.direction==='up' || note.direction==='down') {
      const d=note.direction==='up'?-1:1;
      ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x-3,y+d*12);ctx.lineTo(x,y+d*15);ctx.lineTo(x+3,y+d*12);ctx.stroke();
    }
    if(note.heart || note.type==='special_hp') {
      ctx.font='12px sans-serif';ctx.fillStyle='#ff8db4';ctx.fillText('♥',x+6,y-7);
    }
    if(selected && !isLong) {
      ctx.strokeStyle='#bafa8d';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
    this.hits.push({id:note.id,x1:x-10,x2:(isLong?end:x)+10,y1:y-15,y2:y+15,note});
    if(isLong) this.hits.push({id:note.id,x1:end-7,x2:end+7,y1:y-12,y2:y+12,note,handle:true});
  }

  curveY(position) {
    const air=this.rows.find(row=>row.id==='air');
    const road=this.rows.find(row=>row.id==='road');
    const top=air ? air.y+air.height/2 : this.rows[0].height;
    const bottom=road ? road.y+road.height/2 : air ? air.y+air.height : this.height;
    return bottom-position*(bottom-top);
  }
  curvePosition(y) {
    const value=(y-this.curveY(0))/(this.curveY(1)-this.curveY(0));
    return clamp(Math.round(value*this.api.state.curveDivision)/this.api.state.curveDivision,-1,2);
  }

  drawCurve(note,draft) {
    const {ctx}=this;
    const nodes=note.nodes || [];
    if (!nodes.length) return;
    const state=this.api.state;
    const selected=state.selected.has(note.id);
    const color=note.type.includes('red')?'#ff85a1':'#80cdf8';
    ctx.save();
    ctx.globalAlpha=draft ? .6 : note.layer===state.layer ? 1 : state.layerOpacity;
    ctx.strokeStyle=color;ctx.lineWidth=selected?5:3;
    ctx.beginPath();ctx.moveTo(this.x(nodes[0].time),this.curveY(nodes[0].position));
    for(let i=1;i<nodes.length;i++) {
      const a=nodes[i-1],b=nodes[i];
      let prevX=this.x(a.time),prevY=this.curveY(a.position);
      for(let j=1;j<=12;j++) {
        const part=j/12;
        const x=this.x(a.time+(b.time-a.time)*part);
        const y=this.curveY(a.position+(b.position-a.position)*interpolate(b.curve,part));
        ctx.lineTo(x,y);
        if(!draft) this.hits.push({id:note.id,x1:Math.min(x,prevX)-6,x2:Math.max(x,prevX)+6,y1:Math.min(y,prevY)-7,y2:Math.max(y,prevY)+7,note,segment:i});
        prevX=x;prevY=y;
      }
    }
    ctx.stroke();
    nodes.forEach((node,index)=>{
      const x=this.x(node.time),y=this.curveY(node.position);
      ctx.fillStyle=state.selectedNode?.id===note.id && state.selectedNode.index===index ? '#bafa8d' : color;
      ctx.beginPath();ctx.arc(x,y,selected?5:4,0,Math.PI*2);ctx.fill();
      if(!draft) this.hits.push({id:note.id,x1:x-8,x2:x+8,y1:y-9,y2:y+9,note,node:index});
    });
    ctx.restore();
  }

  updateScrub() {
    const duration=this.api.project().duration;
    const view=this.width/this.scale;
    const thumb=this.scrub.firstElementChild;
    thumb.style.width=`${Math.min(100,view/duration*100)}%`;
    thumb.style.left=`${Math.min(Math.max(0,1-view/duration),this.start/duration)*100}%`;
    this.scrub.setAttribute('aria-valuemax',String(Math.round(duration)));
    this.scrub.setAttribute('aria-valuenow',String(Math.round(this.start)));
  }

  position(event) {
    const bounds=this.canvas.getBoundingClientRect();
    const x=event.clientX-bounds.left,y=event.clientY-bounds.top;
    return {x,y,row:this.rows.find(row=>y>=row.y && y<row.y+row.height)};
  }
  hit(point) {
    return this.hits.findLast(({x1,x2,y1,y2,note})=>point.x>=x1 && point.x<=x2 && point.y>=y1 && point.y<=y2 && this.api.selectable(note));
  }

  pointerdown(event) {
    const p=this.position(event);
    if(event.button===2) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId,p);
    if(this.pointers.size===2) {
      if(this.drag?.snapshot) this.api.restore(this.drag.snapshot);
      const [a,b]=this.pointers.values();
      this.drag={kind:'pinch',distance:Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),scale:this.scale,anchor:this.time((a.x+b.x)/2)};
      return;
    }
    if(this.pointers.size>2 || !p.row) return;
    const state=this.api.state;
    const d={...p,last:p,id:event.pointerId,start:this.start,track:p.row.id,shift:event.shiftKey,alt:event.altKey,ctrl:event.ctrlKey || event.metaKey,pointer:event.pointerType};
    if(event.button===1 || state.mode==='pan') d.kind='pan';
    else if(p.row.id==='ruler' || p.row.id==='wave') {
      d.kind='seek';this.api.seek(this.time(p.x));
    } else {
      const hit=this.hit(p);
      const time=this.api.snap(this.time(p.x));
      Object.assign(d,{time,hit,row:p.row.id});
      if(state.mode==='select' && hit) {
        d.kind='move';
        d.snapshot=this.api.snapshot();
        this.api.select(hit.id,d.shift || d.ctrl || state.multi,hit);
        d.items=this.api.selectedOriginals();
      } else if(state.mode==='select') d.kind='selection';
      else if(state.mode==='erase') d.kind='erase';
      else if(isCurve({type:state.noteType}) && !p.row.axis && ['air','road'].includes(p.row.id)) d.kind='curve';
      else if((isHold(state.noteType) || state.slideFill) && ['air','road'].includes(p.row.id)) d.kind='hold';
      else d.kind='create';
    }
    this.drag=d;
    this.draw();
  }

  pointermove(event) {
    const p=this.position(event);
    const drag=this.drag;
    if(this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId,p);
    if(drag?.kind==='pinch' && this.pointers.size===2) {
      const [a,b]=this.pointers.values();
      const distance=Math.hypot(a.x-b.x,a.y-b.y);
      this.scale=clamp(drag.scale*distance/drag.distance,13,920);
      this.setStart(drag.anchor-(a.x+b.x)/2/this.scale);
      this.api.updateZoom();this.draw();return;
    }
    if(!drag || drag.id!==event.pointerId) {this.hover=p;if(event.pointerType==='mouse')this.draw();return;}
    drag.last=p;
    if(Math.hypot(p.x-drag.x,p.y-drag.y)>4) drag.moved=true;
    if(drag.kind==='pan') this.setStart(drag.start-(p.x-drag.x)/this.scale);
    else if(drag.kind==='seek') this.api.seek(this.time(p.x));
    else if(drag.kind==='hold') drag.end=this.api.snap(this.time(p.x));
    else if(drag.kind==='move' && drag.moved && drag.items.length) {
      this.api.dragSelection(drag,this.api.snap(this.time(p.x))-drag.time,p,this.curvePosition(p.y));
    }
    this.draw();
  }

  pointerup(event) {
    this.pointers.delete(event.pointerId);
    const drag=this.drag;
    if(!drag) return;
    if(drag.kind==='pinch') {if(!this.pointers.size)this.drag=null;return;}
    if(drag.id!==event.pointerId) return;
    this.drag=null;
    const p=this.position(event);
    if(drag.kind==='move' && drag.moved) this.api.finishDrag(drag.snapshot);
    else if(drag.kind==='selection') {
      const add=drag.shift || drag.ctrl || this.api.state.multi;
      if(drag.moved) {
        const minX=Math.min(drag.x,p.x),maxX=Math.max(drag.x,p.x),minY=Math.min(drag.y,p.y),maxY=Math.max(drag.y,p.y);
        this.api.selectMany(this.hits.filter(hit=>hit.x2>=minX && hit.x1<=maxX && hit.y2>=minY && hit.y1<=maxY && this.api.selectable(hit.note)).map(hit=>hit.id),add);
      } else if(!add) this.api.selectMany([],false);
    } else if(drag.kind==='erase' && drag.hit) this.api.remove([drag.hit.id]);
    else if(drag.kind==='curve') this.api.curvePoint(drag.time,this.curvePosition(p.y),drag.hit,drag.ctrl,drag.alt);
    else if(drag.kind==='hold') this.api.insert(drag.row,drag.time,drag.moved ? drag.end : null);
    else if(drag.kind==='create') this.api.insert(drag.row,drag.time);
    this.draw();
  }
  pointercancel(event) {
    this.pointers.delete(event.pointerId);
    if(this.drag?.snapshot) this.api.restore(this.drag.snapshot);
    this.drag=null;this.draw();
  }
  wheel(event) {
    event.preventDefault();
    if(event.ctrlKey || event.metaKey) this.zoom(Math.exp(-event.deltaY*.002),this.position(event).x);
    else {
      const delta=event.deltaX || event.deltaY;
      this.setStart(this.start+delta/this.scale*(event.shiftKey?3:1));
      this.draw();
    }
  }
}
