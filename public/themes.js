/* السمات: [الاسم, الأيقونة, الألوان, التخطيط]
   التخطيطات: grid (بطاقات صور) · card (بطاقات بيضاء) · card1 (بطاقات كبيرة بعمود واحد) · list (قائمة) · wave (رأس موجة + أقسام كحبوب) */
const TH={
classic:['كلاسيكي','🏛️',{bg:'#0b0b0e',cd:'#16161b',tx:'#ffffff',mu:'#a9a9b3',ac:'#e8c468',bd:'#2a2a32',ax:'#111111',cb:'#ffffff'},'grid'],
modern:['عصري','✨',{bg:'#f8fafc',cd:'#ffffff',tx:'#0f172a',mu:'#64748b',ac:'#1fa06f',bd:'#e2e8f0',ax:'#ffffff',cb:'#cbd5e1'},'grid'],
luxury:['فخم','👑',{bg:'#120d09',cd:'#1d1610',tx:'#f7efe2',mu:'#b3a58f',ac:'#c9a35a',bd:'#3a2d1f',ax:'#1a1208',cb:'#c9a35a'},'grid'],
cafe:['مقهى','☕',{bg:'#f5ece0',cd:'#fffaf2',tx:'#3b2a1e',mu:'#85705f',ac:'#8a5a35',bd:'#e4d3bf',ax:'#ffffff',cb:'#8a5a35'},'grid'],
fast:['وجبات سريعة','🔥',{bg:'#fff8e7',cd:'#ffffff',tx:'#1f1300',mu:'#7a6a4f',ac:'#e11d2e',bd:'#f1dfb0',ax:'#ffffff',cb:'#e11d2e'},'grid'],
plain:['بسيط','⬜',{bg:'#ffffff',cd:'#f4f4f5',tx:'#18181b',mu:'#71717a',ac:'#18181b',bd:'#e4e4e7',ax:'#ffffff',cb:'#d4d4d8'},'grid'],
pizza:['بيتزا','🍕',{bg:'#ffffff',cd:'#ffffff',tx:'#0f172a',mu:'#64748b',ac:'#fbbf24',bd:'#eceef3',ax:'#3b2a14',cb:'#e5e7eb',pr:'#e11d2e'},'card'],
goldnight:['ليلي ذهبي','🌙',{bg:'#0b0b0e',cd:'#16161b',tx:'#ffffff',mu:'#a9a9b3',ac:'#e8c468',bd:'#2a2a32',ax:'#111111',cb:'#e8c468'},'grid'],
crimson:['أحمر كبير','🍅',{bg:'#f5f6fa',cd:'#ffffff',tx:'#0f172a',mu:'#64748b',ac:'#d10f1f',bd:'#e6e8ef',ax:'#ffffff',cb:'#d10f1f',pr:'#d10f1f',ab:'linear-gradient(90deg,#d10f1f,#3a0a0f)',at:'#ffffff'},'card1'],
wave:['موجة حمراء','🌊',{bg:'#f6f7fb',cd:'#ffffff',tx:'#0f172a',mu:'#64748b',ac:'#d10f1f',bd:'#e6e8ef',ax:'#ffffff',cb:'#1b1b1b',pr:'#d10f1f',ab:'linear-gradient(90deg,#d10f1f,#3a0a0f)',at:'#ffffff'},'wave'],
cream:['قائمة كريمية','🥣',{bg:'#fff8ee',cd:'#fffaf4',tx:'#2b1d12',mu:'#8a7a6a',ac:'#d10f1f',bd:'#f0e2cf',ax:'#ffffff',cb:'#d10f1f',pr:'#d10f1f',ab:'linear-gradient(90deg,#d10f1f,#3a0a0f)',at:'#ffffff'},'list']
};
const THL={grid:'بطاقات صور',card:'بطاقات بيضاء',card1:'بطاقات كبيرة',list:'قائمة',wave:'رأس موجة'};
function applyTheme(k){
 const t=TH[k]||TH.classic,c=t[2],r=document.documentElement.style,L=t[3]||'grid';
 for(const x in c)r.setProperty('--'+x,c[x]);
 ['pr','ab','at'].forEach(x=>{if(!(x in c))r.removeProperty('--'+x)});
 document.body.className='L-'+L+(L=='grid'?'':' Lc')+(L=='wave'?' L-card1':'');
}
