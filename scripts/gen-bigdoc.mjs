// 生成约 800 页的示例大合同（TXT / DOCX / PDF via electron）。用法：node scripts/gen-bigdoc.mjs <outdir> [pages]
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
const out = process.argv[2] || '/workspace/zhihe-testdata'; const PAGES = Number(process.argv[3] || 800)
mkdirSync(out, { recursive: true })
const num = ['一','二','三','四','五','六','七','八','九','十']
const cn = (n) => { if (n <= 10) return num[n-1]; if (n < 20) return '十' + (n % 10 ? num[n%10-1] : ''); if (n < 100) return num[Math.floor(n/10)-1] + '十' + (n%10 ? num[n%10-1] : ''); return String(n) }
const modules = ['统一身份认证','订单中心','库存管理','仓储调度','运输管理','财务结算','供应商门户','数据中台','移动端','报表平台','消息总线','风控引擎']
const head = [
 '智慧供应链平台建设及运维总承包合同', '合同编号：C-2026-BIG-800', '【示例数据】本合同为智合大文件性能测试样本（约 800 页），内容虚构。', '',
 '甲方：星海科技（上海）有限公司', '乙方：华东云链信息技术股份有限公司', '',
 '第一条 合同标的', '乙方为甲方建设智慧供应链平台，包括需求分析、设计、开发、测试、部署、数据迁移、培训及五年运维服务，详见附件一至附件九。', '',
 '第二条 合同金额', '本合同总金额为人民币36,800,000元（含税），其中建设费26,800,000元，运维费10,000,000元。', '',
 '第三条 付款方式', '按里程碑付款：合同生效后支付建设费的40%作为预付款；系统上线验收合格后支付40%；质保期满后支付20%。运维费按年支付，每年度结束后30日内付款。甲方应于合同生效后10个工作日内支付合同总额40%作为预付款。', '',
 '第四条 合同期限', '本合同自2026-11-01起生效，至2031-10-31止。期满前三十日任何一方未书面提出异议的，本合同自动续期一年。', ''
]
const special = {
  120: ['第二百零一条 违约责任', '任何一方违约的，应向守约方支付合同总额15%的违约金。'],
  300: ['第三百一十二条 数据处理', '为提供运维服务，乙方可将甲方业务数据及员工个人信息传输至乙方位于新加坡的灾备中心存储和处理，甲方对此予以同意。'],
  530: ['第五百四十四条 排他合作', '合同期内，甲方不得就供应链相关系统与任何第三方开展合作，乙方为甲方唯一的供应链系统服务商。'],
  690: ['第六百九十八条 适用法律与争议解决', '本合同适用香港特别行政区法律。因本合同引起的争议，提交香港国际仲裁中心仲裁。'],
  777: ['第七百八十条 责任承担', '因甲方提供的数据导致的任何损失，由甲方承担无限连带责任，乙方的赔偿责任不超过当年运维费的10%。'],
  796: ['第八百条 保密', '双方对在履行本合同过程中知悉的对方商业秘密负有保密义务，保密期限为合同终止后五年。', '第八百零一条 合同解除', '任何一方提前解除合同的，应提前60日书面通知对方。', '签订日期：2026-10-25', '甲方（盖章）：星海科技（上海）有限公司        乙方（盖章）：华东云链信息技术股份有限公司']
}
let art = 5
const pages = []
for (let p = 1; p <= PAGES; p++) {
  const L = []
  if (p === 1) L.push(...head)
  else if (special[p]) L.push(...special[p])
  else {
    const m = modules[p % modules.length]
    L.push(`附件${cn((p % 9) + 1)} 技术规格书 · ${m}（第 ${p} 页）`)
    for (let k = 0; k < 9; k++) {
      const id = `${m.slice(0,2)}-${String(p).padStart(3,'0')}-${k+1}`
      L.push(`${art++ % 7 === 0 ? `第${cn(Math.min(99,(art%99)+1))}条 ` : ''}需求 ${id}：系统应支持${m}的${['批量导入导出','多级审批流','实时监控告警','权限细粒度控制','高可用部署','审计日志留存','接口限流熔断','移动端适配','数据归档清理'][k]}，并发用户不少于 ${(k+2)*500} 人，平均响应时间不超过 ${(k%3+1)*200} 毫秒，可用性不低于 99.${9-(k%3)}%；验收时乙方应提交测试报告和用户手册。`)
    }
  }
  pages.push(L)
}
const text = pages.map((l) => l.join('\n')).join('\n\n')
writeFileSync(join(out, 'big-contract-800p.txt'), text)
console.log('chars', text.length, 'pages', PAGES)
// DOCX：最小合法 OOXML 包
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const body = pages.map((l, i) => l.map((x) => `<w:p><w:r><w:t xml:space="preserve">${esc(x)}</w:t></w:r></w:p>`).join('') + (i < pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '')).join('')
const tmp = '/tmp/zh-docx'; rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(tmp, '_rels'), { recursive: true }); mkdirSync(join(tmp, 'word'), { recursive: true })
writeFileSync(join(tmp, '[Content_Types].xml'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
writeFileSync(join(tmp, '_rels/.rels'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
writeFileSync(join(tmp, 'word/document.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`)
rmSync(join(out, 'big-contract-800p.docx'), { force: true })
execSync(`cd ${tmp} && zip -q -X -r ${join(out, 'big-contract-800p.docx')} '[Content_Types].xml' _rels word`)
// PDF 用 HTML（每页一个 section，强制分页）
const html = `<html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:10.5pt;line-height:1.55}section{page-break-after:always}p{margin:0 0 4px}</style></head><body>${pages.map((l) => `<section>${l.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`).join('')}</body></html>`
writeFileSync('/tmp/zh-big.html', html)
console.log('docx ok; html for pdf at /tmp/zh-big.html')
