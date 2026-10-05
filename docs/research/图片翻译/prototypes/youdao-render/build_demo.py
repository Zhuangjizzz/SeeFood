"""PROTOTYPE: package recorded evidence as a standalone offline HTML viewer."""

import base64
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent


def data_uri(path):
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


records = []
for log in sorted((ROOT / "results").glob("2026-10-06-*/requests.jsonl")):
    for line in log.read_text().splitlines():
        row = json.loads(line)
        sample = ROOT / "samples" / (row["sample_id"] + ".png")
        row["original"] = data_uri(sample)
        row["translated"] = data_uri(log.parent / row["images"][0]["file"]) if row.get("images") else None
        row["run"] = log.parent.name
        row.pop("aigc", None)
        records.append(row)

tile_records = [r for r in records if r["run"] == "2026-10-06-long-tiles"]
tile_records.sort(key=lambda r: r["sample_id"])
tile_output = ROOT / "results/2026-10-06-long-tiles"
merged = Image.new("RGB", (900, 4800))
offset = 0
for row in tile_records:
    im = Image.open(tile_output / row["images"][0]["file"])
    merged.paste(im, (0, offset))
    offset += im.height
merged.save(tile_output / "long-stitched.jpg", quality=94)
whole_record = next(r for r in records if r["sample_id"] == "long" and r["language"] == "en")
whole_image = Image.open(ROOT / "results" / whole_record["run"] / whole_record["images"][0]["file"])
for name, im in [("whole", whole_image), ("split", merged)]:
    im.crop((0, 575, 900, 1585)).save(tile_output / f"long-{name}-crop.jpg")
payload = json.dumps(records, ensure_ascii=False).replace("<", "\\u003c")
stitched = data_uri(ROOT / "results/2026-10-06-long-tiles/long-stitched.jpg")
template = r'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>有道图片翻译 · 原型验证</title>
<style>
body{font:16px/1.6 system-ui,sans-serif;color:#20362c;background:#f5f4ee;margin:0;padding:24px}main{max-width:1250px;margin:auto}h1{font-size:26px;margin:0}h2{font-size:19px}p{margin:10px 0}button,select{font:inherit;padding:7px 12px;margin:4px;border:1px solid #b8c9bf;border-radius:6px;background:white;color:#20362c;cursor:pointer}button.active{background:#24583c;color:white}.panel{background:white;border-radius:8px;padding:16px;margin:18px 0}.views{display:grid;grid-template-columns:1fr 1fr;gap:14px}.frame{height:650px;overflow:auto;background:#e8ebe4}.frame img{width:100%;display:block}.frame img[hidden]{display:none}.frame.native img{width:auto;max-width:none}small{color:#59675e}dl{display:grid;grid-template-columns:125px 1fr;margin:0}dt,dd{margin:0;padding:3px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.warn{color:#8d3423}.tabs{display:flex;flex-wrap:wrap}.step{background:#f0f6f1}@media(max-width:800px){.views{grid-template-columns:1fr}.frame{height:450px}body{padding:12px}}
</style><main>
<h1>有道图片翻译 · 原型验证</h1>
<p>问题：有道是否能把译文直接写回图片，同时保留菜单价格与每道菜的位置？这里展示真实 API 响应；按钮只回放已记录结果，不会调用 API。</p>
<p><small>抛弃式原型。2026-10-06，6 张程序生成的菜单样本；不代表真实餐厅、食物照片或手机网络效果。简体中文查看原图，零调用。</small></p>
<section class="panel"><h2>当前结果</h2><dl id="state"></dl><p class="warn" id="notice"></p></section>
<section class="panel"><h2>自由查看</h2>
<label>样本<select id="sample"></select></label><label>语言<select id="lang"><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option><option value="es">西班牙语</option></select></label>
<button onclick="chooseModel(0)">传统翻译</button><button onclick="chooseModel(1)">大模型 Pro 对照</button><button onclick="chooseRender(0)">只看文字响应</button><button onclick="chooseRender(1)">查看译图响应</button><button onclick="originalOnly()">简体中文：原图</button><button onclick="toggleSize()">适应宽度／原尺寸</button>
<div class="views"><div><strong>原图</strong><div class="frame"><img id="original" alt="合成原图"></div></div><div><strong id="translationTitle">译图</strong><div class="frame"><img id="translated" alt="API译图"><p id="noimage"></p></div></div></div></section>
<section class="panel"><h2>引导查看</h2><div class="tabs" id="tabs"></div><p id="scenario"></p><div id="steps"></div></section>
<section class="panel"><h2>原文与译文</h2><p><small>区域坐标来自 API。价格标红仅用于指出应核对内容，不代表完成了价格保护。</small></p><table><thead><tr><th>原文</th><th>译文</th><th>位置 x,y,w,h</th></tr></thead><tbody id="regions"></tbody></table></section>
<details class="panel"><summary>响应字段与测量记录</summary><pre id="details" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details>
</main><script>
const records=__RECORDS__;
const stitched=__STITCHED__;
const samples={single:'单列菜单',columns:'双列菜单',illustrated:'带几何插图',screenshot:'模拟电子菜单',long:'4800像素长图','dim-photo':'模拟暗光斜拍'};
// Pure selection logic; no DOM or networking.
function selectRecord(items,query){return items.find(r=>r.sample_id===query.sample&&r.language===query.language&&r.model===query.model&&r.render===query.render)||null}
let state={sample:'single',language:'en',model:0,render:1,originalOnly:false,stitched:false};
function render(){
 const row=state.originalOnly?records.find(r=>r.sample_id===state.sample):selectRecord(records,state),image=state.originalOnly?row?.original:state.stitched?stitched:row?.translated;
 document.getElementById('sample').value=state.sample;document.getElementById('lang').value=state.language;
 const tiles=records.filter(r=>r.run==='2026-10-06-long-tiles');
 const fields={'样本':samples[state.sample]||state.sample,'目标语言':state.originalOnly?'简体中文（原图）':state.language,'模型':state.originalOnly?'无需翻译':state.model===0?'传统 NMT':'大模型 Pro','状态':row?(state.originalOnly?'原图展示，无新调用':image?'译图已解码':'仅文字响应'):'此组合未执行','API请求':state.originalOnly?'零调用':state.stitched?(tiles.reduce((sum,r)=>sum+r.api_ms,0)/1000).toFixed(3)+' 秒（4片累计；不含片间等待）':row?(row.api_ms/1000).toFixed(3)+' 秒':'—','本机解码完成':state.originalOnly?'未计时':state.stitched?(tiles.reduce((sum,r)=>sum+r.ready_ms,0)/1000).toFixed(3)+' 秒（逐片累计，不是全图端到端耗时）':row?(row.ready_ms/1000).toFixed(3)+' 秒':'—','图片尺寸':row?row.source_size.join('×')+' → '+(state.originalOnly?row.source_size.join('×'):(row.images[0]?.size.join('×')||'无译图')):'—','验证方式':state.originalOnly?'本地原图展示':state.stitched?'4次英文切片调用后合成':'真实响应回放，无新调用'};
 const dl=document.getElementById('state');dl.replaceChildren();for(const [k,v]of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;dl.append(dt,dd)}
 document.getElementById('notice').textContent=state.originalOnly?'目标为简体中文，保留原图。':state.sample==='long'&&!state.stitched?'整图存在多菜名合并、跨行错位；不能凭返回原尺寸认定长图合格。':'价格需要核对：传统翻译可能把 ¥ 误译成其他文字或日元；不是完成的产品。';
 const src=document.getElementById('original'),dst=document.getElementById('translated');src.src=row?.original||'';dst.src=image||'';src.hidden=!row;dst.hidden=!image;document.getElementById('noimage').textContent=image?'':row?'此响应没有图片字段。':'此组合未执行，请选择已验证组合。';
 document.getElementById('translationTitle').textContent=state.originalOnly?'简体中文原图':state.stitched?'英文分段合成图':'供应商译图';
 let regions=state.originalOnly?[]:row?.regions||[];
 if(state.stitched){let y=0;regions=[];for(const tile of tiles){for(const r of tile.regions){const box=r.boundingBox.split(',').map(Number);box[1]+=y;regions.push({...r,boundingBox:box.join(',')})}y+=tile.source_size[1]}}
 const tbody=document.getElementById('regions');tbody.replaceChildren();for(const r of regions){let tr=document.createElement('tr');if(/[¥￥]/.test(r.context||''))tr.className='warn';for(const value of [r.context,r.tranContent,r.boundingBox]){let td=document.createElement('td');td.textContent=value;tr.append(td)}tbody.append(tr)}
 const clean=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['original','translated','regions'].includes(k)));
 const summary=state.originalOnly?{mode:'原图展示',api_calls:0}:state.stitched?{mode:'4片合成；坐标已映射到全图',records:tiles.map(clean)}:row?clean(row):state;document.getElementById('details').textContent=JSON.stringify(summary,null,2);
}
function reset(patch){state={sample:'single',language:'en',model:0,render:1,originalOnly:false,stitched:false,...patch};render()}
function chooseModel(model){state.model=model;state.render=1;state.originalOnly=false;state.stitched=false;render()}
function chooseRender(renderMode){state.sample='single';state.language='en';state.model=0;state.render=renderMode;state.originalOnly=false;state.stitched=false;render()}
function originalOnly(){state.originalOnly=true;state.stitched=false;render()}
function toggleSize(){document.querySelectorAll('.frame').forEach(x=>x.classList.toggle('native'))}
const scenarios=[
 {name:'成图是否真实',desc:'先查看传统英文译图，再切到只看文字。确认文字响应和可查看译图是两种不同结果。',steps:[['英文译图',()=>reset({})],['只有文字',()=>reset({render:0})],['中文走原图',()=>{reset({});originalOnly()}]]},
 {name:'价格与译文',desc:'观察价格 ¥38 在四种语言中的变化，再查看 Pro 对照。价格和菜名都需要核对。',steps:[['英文价格',()=>reset({})],['日语价格',()=>reset({language:'ja'})],['西语价格',()=>reset({language:'es'})],['Pro日语',()=>reset({language:'ja',model:1})]]},
 {name:'长图与分段',desc:'同一张长菜单：整图返回成功但出现合并区域；按已知行间空隙切成4片，观察排版变化。分段增加调用数，价格误译仍需处理。',steps:[['整图结果',()=>reset({sample:'long'})],['分段合成',()=>reset({sample:'long',stitched:true})],['双列对照',()=>reset({sample:'columns'})]]}
];
function walkthrough(i){reset({});const s=scenarios[i];document.getElementById('scenario').textContent=s.desc;const steps=document.getElementById('steps');steps.replaceChildren();s.steps.forEach(([label,action],index)=>{const b=document.createElement('button');b.className='step';b.textContent=(index+1)+'. '+label;b.onclick=action;steps.append(b)});document.querySelectorAll('#tabs button').forEach((b,j)=>b.classList.toggle('active',i===j))}
for(const [key,label]of Object.entries(samples)){const option=document.createElement('option');option.value=key;option.textContent=label;document.getElementById('sample').append(option)}
document.getElementById('sample').onchange=e=>{state.sample=e.target.value;state.originalOnly=false;state.stitched=false;render()};document.getElementById('lang').onchange=e=>{state.language=e.target.value;state.originalOnly=false;state.stitched=false;render()};
scenarios.forEach((s,i)=>{const b=document.createElement('button');b.textContent=s.name;b.onclick=()=>walkthrough(i);document.getElementById('tabs').append(b)});walkthrough(0);
</script></html>'''
html = template.replace("__RECORDS__", payload).replace("__STITCHED__", json.dumps(stitched))
(ROOT / "demo.html").write_text(html)
print(f"已生成离线 demo.html，包含 {len(records)} 次真实响应。")
