(function(){
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),stage=document.getElementById('stage'),tag=document.getElementById('tag');
document.getElementById('x1').onclick=document.getElementById('x2').onclick=()=>{document.querySelector('.banner').style.display='none'};
const RAMP=" .:;+=*xo#%&@";
let W=0,H=0,dpr=1,cw=6.4,ch=11,cols=0,rows=0,R=0,fs=9;
function resize(){
  dpr=Math.min(window.devicePixelRatio||1,2);
  W=stage.clientWidth;H=stage.clientHeight;
  cv.width=W*dpr;cv.height=H*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.font='700 '+fs+'px ui-monospace,Menlo,Consolas,monospace';ctx.textBaseline='top';
  cw=ctx.measureText('M').width;ch=fs*1.06;
  cols=Math.floor(W/cw);rows=Math.floor(H/ch);
  R=Math.min(H*0.33,W*0.36);
}
window.addEventListener('resize',resize);resize();
const NT=128,SRC=window.HYDRA_FACES;
const FACES=["MDF", "STHD", "SC", "PKSF", "ARD", "AIA", "AED"].map(n=>({n,ring:[150,150,150]}));
const TEX=[];
function hash(x,y){let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295}
SRC.forEach((src,i)=>{const im=new Image();im.onload=()=>{
  const c=document.createElement('canvas');c.width=c.height=NT;const x=c.getContext('2d');x.drawImage(im,0,0,NT,NT);
  const d=x.getImageData(0,0,NT,NT).data;TEX[i]=d;
  const o=(4*NT+NT/2|0)*4;FACES[i].ring=[d[o],d[o+1],d[o+2]];
};im.src=src});
const h=0.1,L=norm([-0.55,0.6,0.58]);
function norm(a){const m=Math.hypot(a[0],a[1],a[2]);return[a[0]/m,a[1]/m,a[2]/m]}
let spin=0,tilt=0,t0=performance.now(),last=t0,flips=0,prevHalf=0,faceF=0,faceB=1,nextFace=2,mx=0,my=0,boost=0;
stage.addEventListener('pointermove',e=>{const b=stage.getBoundingClientRect();mx=(e.clientX-b.left)/b.width-.5;my=(e.clientY-b.top)/b.height-.5});
document.getElementById('go').addEventListener('pointerenter',()=>{boost=1});
const stars=[];for(let i=0;i<90;i++)stars.push([Math.random(),Math.random(),Math.random()<.5?'+':'.',.12+Math.random()*.18]);
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;const t=(now-t0)/1000;
  boost*=Math.pow(.2,dt);
  spin+=dt*(1.5+1.1*Math.sin(t*.55)+boost*4);
  tilt=0.28*Math.sin(t*.7)+my*.5;
  const half=Math.floor((spin+Math.PI/2)/Math.PI);
  if(half!==prevHalf){prevHalf=half;if(Math.cos(spin)>0)faceB=(nextFace++)%FACES.length;else faceF=(nextFace++)%FACES.length;}
  const ys=spin+mx*.6;
  const cy_=Math.cos(ys),sy=Math.sin(ys),cx_=Math.cos(tilt),sx=Math.sin(tilt);
  // M = Rx * Ry ; columns for forward transform, transpose for inverse
  const M=[[cy_,0,sy],[sx*sy,cx_,-sx*cy_],[-cx_*sy,sx,cx_*cy_]];
  const MT=[[M[0][0],M[1][0],M[2][0]],[M[0][1],M[1][1],M[2][1]],[M[0][2],M[1][2],M[2][2]]];
  const dz=[MT[0][2]*-1,MT[1][2]*-1,MT[2][2]*-1];
  ctx.clearRect(0,0,W,H);
  ctx.font='700 '+fs+'px ui-monospace,Menlo,Consolas,monospace';ctx.textBaseline='top';
  // starfield
  ctx.fillStyle='#fff';
  for(const s of stars){ctx.globalAlpha=s[3]*(.6+.4*Math.sin(t*1.3+s[0]*20));ctx.fillText(s[2],s[0]*W,s[1]*H)}
  ctx.globalAlpha=1;
  const pal=FACES[Math.cos(spin+mx*.6)>0?faceF:faceB].ring,ox0=W/2,oy0=H/2;
  for(let j=0;j<rows;j++){
    const py=j*ch+ch/2,y=-(py-oy0)/R;
    for(let i=0;i<cols;i++){
      const px=i*cw+cw/2,x=(px-ox0)/R;
      if(x*x+y*y>1.5)continue;
      // ray origin in coin space
      const o=[MT[0][0]*x+MT[0][1]*y+MT[0][2]*5,MT[1][0]*x+MT[1][1]*y+MT[1][2]*5,MT[2][0]*x+MT[2][1]*y+MT[2][2]*5];
      let best=1e9,kind=0,p=null;
      if(Math.abs(dz[2])>1e-4){
        for(const s of[1,-1]){const tt=(s*h-o[2])/dz[2];if(tt>0&&tt<best){const X=o[0]+dz[0]*tt,Y=o[1]+dz[1]*tt;if(X*X+Y*Y<=1){best=tt;kind=s;p=[X,Y]}}}
      }
      const a=dz[0]*dz[0]+dz[1]*dz[1];
      if(a>1e-6){
        const b=2*(o[0]*dz[0]+o[1]*dz[1]),c=o[0]*o[0]+o[1]*o[1]-1,disc=b*b-4*a*c;
        if(disc>=0){const sq=Math.sqrt(disc);for(const tt of[(-b-sq)/(2*a),(-b+sq)/(2*a)]){
          if(tt>0&&tt<best){const Z=o[2]+dz[2]*tt;if(Math.abs(Z)<=h){best=tt;kind=2;p=[o[0]+dz[0]*tt,o[1]+dz[1]*tt]}}}}
      }
      if(!p)continue;
      let n=kind===2?[p[0],p[1],0]:[0,0,kind];
      const wn=[M[0][0]*n[0]+M[0][1]*n[1]+M[0][2]*n[2],M[1][0]*n[0]+M[1][1]*n[1]+M[1][2]*n[2],M[2][0]*n[0]+M[2][1]*n[1]+M[2][2]*n[2]];
      const diff=Math.max(0,wn[0]*L[0]+wn[1]*L[1]+wn[2]*L[2]);
      const hv=norm([L[0],L[1],L[2]+1]);const spec=Math.pow(Math.max(0,wn[0]*hv[0]+wn[1]*hv[1]+wn[2]*hv[2]),24);
      const light=Math.min(1,.18+diff*.75+spec*.6);
      let ch_='',r_,g_,b_,al=1;
      const tang=()=>{ // slanted glyph from screen tangent of the surface normal
        const ang=Math.atan2(wn[1],wn[0])+Math.PI/2;let d=((ang%Math.PI)+Math.PI)%Math.PI;
        const q=Math.round(d/(Math.PI/4))%4;return['-','/','|','\\'][q]};
      if(kind===2){
        ch_=tang();const k=.28+light*.9;r_=pal[0]*k;g_=pal[1]*k;b_=pal[2]*k;
        if(spec>.25){r_=g_=b_=255}
      }else{
        const u=kind===1?p[0]:-p[0],v=p[1];
        const fi=kind===1?faceF:faceB,T=TEX[fi];
        if(!T)continue;
        const uu=kind===1?p[0]:-p[0];
        const tx=Math.min(NT-1,Math.max(0,((uu*.5+.5)*NT)|0)),ty=Math.min(NT-1,Math.max(0,((.5-p[1]*.5)*NT)|0)),o=(ty*NT+tx)*4;
        const cr=T[o],cg=T[o+1],cb=T[o+2],Y=(.3*cr+.59*cg+.11*cb)/255;
        const val=Y*(.55+.75*light);
        const idx=Math.floor(Math.min(1,val*1.25)*(RAMP.length-1));
        if(idx<1){if(hash(i,j)<.06){ch_='.';r_=g_=b_=60;al=.6}else continue}
        else{
          ch_=RAMP[idx];const k=.7+.6*light;
          r_=cr*k+20;g_=cg*k+20;b_=cb*k+20;
        }
      }
      ctx.globalAlpha=al;
      ctx.fillStyle='rgb('+(r_>255?255:r_|0)+','+(g_>255?255:g_|0)+','+(b_>255?255:b_|0)+')';
      ctx.fillText(ch_,i*cw,j*ch);
    }
  }
  ctx.globalAlpha=1;
  tag.style.left=(W/2-R*1.5)+'px';tag.style.top=(H/2+R*0.5+Math.sin(t)*6)+'px';
  tag.textContent='. .\n* '+FACES[Math.cos(spin)>0?faceF:faceB].n.toLowerCase()+' .ff';
  if(!reduce)requestAnimationFrame(frame);
}
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
requestAnimationFrame(frame);
})();
