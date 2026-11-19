import type { Contract, Rule, Status, Milestone } from './types'
interface P { id: string; title: string; type: string; a: string; b: string; amount: number; sign: string; start: string; end: string; status: Status
  pay: string; pre: number; penalty: number; cap: string; law: string; dispute: string; conf: boolean; notice: number; renew: boolean; warranty: number; ip: string; subject: string; owner: string; ms: Omit<Milestone, 'id'>[] }
const yuan = (n: number) => n.toLocaleString('zh-CN')
export function contractText(p: P) {
  return `${p.title}
合同编号：${p.id}
【示例数据】本合同为智合内置示例，仅用于演示，不构成任何法律意见。

甲方：${p.a}
乙方：${p.b}

第一条 合同标的
${p.subject}

第二条 合同金额
本合同总金额为人民币${yuan(p.amount)}元（含税）。

第三条 付款方式
${p.pay}${p.pre ? `甲方应于合同生效后10个工作日内支付合同总额${p.pre}%作为预付款。` : ''}

第四条 合同期限
本合同自${p.start}起生效，至${p.end}止。${p.renew ? '期满前三十日任何一方未书面提出异议的，本合同自动续期一年。' : '期满后如需续约，双方另行签订书面协议。'}

第五条 质量保证
${p.warranty ? `乙方提供自验收合格之日起${p.warranty}个月的质保期。` : '本合同不涉及质保期。'}

第六条 知识产权
${p.ip}

第七条 保密
${p.conf ? '双方对在履行本合同过程中知悉的对方商业秘密负有保密义务，保密期限为合同终止后三年。' : '（本合同未约定保密条款）'}

第八条 违约责任
${p.penalty ? `任何一方违约的，应向守约方支付合同总额${p.penalty}%的违约金。` : '违约方应赔偿守约方因此遭受的实际损失。'}${p.cap ? p.cap : ''}

第九条 合同解除
${p.notice ? `任何一方提前解除合同的，应提前${p.notice}日书面通知对方。` : '未经双方协商一致，任何一方不得单方解除本合同。'}

第十条 适用法律与争议解决
本合同适用${p.law}。${p.dispute}

签订日期：${p.sign}
甲方（盖章）：${p.a}        乙方（盖章）：${p.b}
`
}
const ME = '星海科技（上海）有限公司'
const P_LIST: P[] = [
  { id: 'C-2023-001', title: 'IT 系统运维服务合同', type: '服务合同', a: ME, b: '深蓝信息技术有限公司', amount: 480000, sign: '2023-01-05', start: '2023-01-10', end: '2025-12-31', status: 'archived', owner: '王敏',
    pay: '甲方按季度支付服务费，每季度结束后15日内凭发票支付。', pre: 0, penalty: 10, cap: '双方累计赔偿责任以合同总金额为上限。', law: '中华人民共和国法律', dispute: '争议提交上海仲裁委员会仲裁。', conf: true, notice: 30, renew: false, warranty: 0, ip: '运维过程中形成的文档归甲方所有。', subject: '乙方为甲方提供服务器、网络及办公系统 7×24 小时运维服务。',
    ms: [{ title: '2025年Q4服务费', due: '2026-01-15', kind: 'payment', amount: 40000, done: true }, { title: '年度运维报告', due: '2025-12-31', kind: 'delivery', done: true }] },
  { id: 'C-2024-002', title: '办公楼租赁合同', type: '租赁合同', a: ME, b: '上海浦江置业有限公司', amount: 3600000, sign: '2024-11-20', start: '2024-12-01', end: '2026-11-30', status: 'performing', owner: '李娜',
    pay: '租金按月支付，甲方应于每月5日前支付当月租金。', pre: 0, penalty: 5, cap: '', law: '中华人民共和国法律', dispute: '争议由房屋所在地人民法院管辖。', conf: false, notice: 90, renew: true, warranty: 0, ip: '不涉及。', subject: '乙方将位于上海市浦东新区张江路 88 号 12 层（建筑面积 1,200 平方米）出租给甲方作办公使用。',
    ms: [{ title: '2026年10月租金', due: '2026-10-05', kind: 'payment', amount: 150000, done: true }, { title: '2026年11月租金', due: '2026-11-05', kind: 'payment', amount: 150000, done: false }, { title: '续租意向书面通知', due: '2026-10-31', kind: 'obligation', done: false }] },
  { id: 'C-2024-003', title: '云服务器与存储采购合同', type: '采购合同', a: ME, b: 'Nimbus Cloud Pte. Ltd.', amount: 2800000, sign: '2024-06-18', start: '2024-07-01', end: '2027-06-30', status: 'performing', owner: '陈涛',
    pay: '甲方应于每年7月1日前支付当年度服务费。', pre: 60, penalty: 0, cap: '', law: '新加坡法律', dispute: '争议提交新加坡国际仲裁中心仲裁。', conf: true, notice: 15, renew: true, warranty: 0, ip: '乙方保留平台全部知识产权，甲方数据归甲方所有。', subject: '乙方向甲方提供云服务器（ECS 200 台）、对象存储 500TB 及相关技术支持服务。',
    ms: [{ title: '首期预付款(60%)', due: '2024-07-11', kind: 'payment', amount: 1680000, done: true }, { title: '2025年度服务费', due: '2025-07-01', kind: 'payment', amount: 560000, done: true }, { title: '2026年度服务费', due: '2026-07-01', kind: 'payment', amount: 560000, done: false }, { title: 'SLA 季度报告', due: '2026-10-10', kind: 'delivery', done: false }] },
  { id: 'C-2025-004', title: '移动端 App 软件开发外包合同', type: '技术开发', a: ME, b: '杭州青禾软件有限公司', amount: 860000, sign: '2025-09-01', start: '2025-09-10', end: '2026-12-31', status: 'approval', owner: '赵磊',
    pay: '按里程碑付款：需求确认后付30%，验收通过后付60%，质保期满付10%。', pre: 30, penalty: 20, cap: '乙方赔偿责任以合同总金额为上限。', law: '中华人民共和国法律', dispute: '争议提交杭州仲裁委员会仲裁。', conf: true, notice: 30, renew: false, warranty: 12, ip: '开发成果的全部知识产权归甲方所有。', subject: '乙方为甲方开发 iOS/Android 客户端及管理后台，详见附件需求说明书。',
    ms: [{ title: '需求确认款(30%)', due: '2025-10-15', kind: 'payment', amount: 258000, done: false }, { title: 'Beta 版交付', due: '2026-06-30', kind: 'delivery', done: false }] },
  { id: 'C-2026-005', title: '原材料年度采购框架协议', type: '采购合同', a: ME, b: '江苏恒远新材料股份有限公司', amount: 12500000, sign: '2026-01-08', start: '2026-01-10', end: '2026-12-31', status: 'review', owner: '王敏',
    pay: '货到验收合格后90日内付款。', pre: 0, penalty: 35, cap: '', law: '中华人民共和国法律', dispute: '争议由乙方所在地人民法院管辖。', conf: false, notice: 0, renew: true, warranty: 6, ip: '不涉及。', subject: '乙方按甲方订单供应改性塑料粒子，年度预计采购量 1,000 吨。',
    ms: [] },
  { id: 'C-2026-006', title: '品牌市场推广服务合同', type: '服务合同', a: ME, b: '北京灵犀传媒有限公司', amount: 650000, sign: '2026-10-15', start: '2026-11-01', end: '2027-04-30', status: 'draft', owner: '李娜',
    pay: '合同签订后支付50%，活动结束并提交结案报告后支付50%。', pre: 50, penalty: 10, cap: '', law: '中华人民共和国法律', dispute: '争议提交北京仲裁委员会仲裁。', conf: true, notice: 30, renew: false, warranty: 0, ip: '推广物料著作权归甲方所有。', subject: '乙方为甲方提供 2026 冬季新品上市整合营销推广服务。',
    ms: [] },
  { id: 'C-2022-007', title: '生产设备采购合同', type: '采购合同', a: ME, b: '德阳重工机械有限公司', amount: 1980000, sign: '2022-03-02', start: '2022-03-02', end: '2024-03-01', status: 'archived', owner: '陈涛',
    pay: '预付30%，到货验收后支付60%，质保金10%于质保期满后支付。', pre: 30, penalty: 10, cap: '赔偿总额不超过合同总额的30%。', law: '中华人民共和国法律', dispute: '争议提交中国国际经济贸易仲裁委员会仲裁。', conf: true, notice: 30, renew: false, warranty: 24, ip: '不涉及。', subject: '乙方向甲方提供注塑成型设备 4 台及安装调试服务。',
    ms: [{ title: '质保金支付', due: '2024-03-15', kind: 'payment', amount: 198000, done: true }] },
  { id: 'C-2026-008', title: '战略合作保密协议', type: '保密协议', a: ME, b: '南京智创数据科技有限公司', amount: 0, sign: '2026-10-18', start: '2026-10-20', end: '2028-10-19', status: 'signing', owner: '赵磊',
    pay: '本协议不涉及费用支付。', pre: 0, penalty: 0, cap: '', law: '中华人民共和国法律', dispute: '争议提交南京仲裁委员会仲裁。', conf: true, notice: 30, renew: false, warranty: 0, ip: '双方各自既有知识产权归各自所有。', subject: '双方就数据合作项目交换保密信息。',
    ms: [] }
]
export function sampleContracts(): Contract[] {
  return P_LIST.map((p) => {
    const text = contractText(p)
    const order: Status[] = ['draft', 'review', 'approval', 'signing', 'performing', 'archived']
    const hist = order.slice(0, order.indexOf(p.status) + 1).map((s, i) => ({ at: p.sign, status: s, note: i === 0 ? '创建' : '流转' }))
    return {
      id: p.id, title: p.title, type: p.type, counterparty: p.b, owner: p.owner, status: p.status, amount: p.amount, endDate: p.end,
      text, approvedText: p.id === 'C-2026-008' ? text.replace('保密期限为合同终止后三年', '保密期限为合同终止后五年') : undefined,
      facts: {}, milestones: p.ms.map((m, i) => ({ ...m, id: `${p.id}-m${i}`, source: '手工' as const })), history: hist, sample: true, createdAt: p.sign, tags: ['示例数据']
    }
  })
}
const R = (code: string, name: string, category: string, severity: 'fail' | 'warn', script: string, message: string): Rule => ({ id: code, code, name, category, severity, enabled: true, script, message, sample: true })
export function sampleRules(): Rule[] {
  return [
    R('R001', '必须明确甲乙双方', '主体', 'fail', 'return !!f.partyA && !!f.partyB', '合同主体信息缺失'),
    R('R002', '适用中国法律', '法律适用', 'fail', "return /中华人民共和国|中国/.test(f.governingLaw || '')", '适用法律非中国法律：' + "${f.governingLaw}"),
    R('R003', '争议解决方式须明确', '法律适用', 'warn', "return !!f.disputeResolution", '未约定争议解决方式'),
    R('R004', '合同金额须大于 0（保密协议除外）', '金额', 'warn', "return c.type === '保密协议' || f.amount > 0", '合同金额为空或为 0'),
    R('R005', '预付款比例不超过 30%', '付款', 'fail', 'return !f.prepaymentRatio || f.prepaymentRatio <= 30', '预付款比例 ${f.prepaymentRatio}% 超过公司上限 30%'),
    R('R006', '付款账期不超过 60 天', '付款', 'warn', "const m = (f.paymentTerms||'').match(/(\\d+)日内付款/); return !m || Number(m[1]) <= 60", '付款账期过长：${f.paymentTerms}'),
    R('R007', '违约金比例不超过 30%', '违约责任', 'warn', 'return !f.penaltyRate || f.penaltyRate <= 30', '违约金比例 ${f.penaltyRate}% 过高，可能被认定为过分高于损失'),
    R('R008', '须约定违约金或赔偿机制', '违约责任', 'warn', "return !!f.penaltyRate || /赔偿/.test(f.liability||'')", '未约定明确违约责任'),
    R('R009', '大额合同须设责任上限', '违约责任', 'warn', "return f.amount < 1000000 || !!f.liabilityCap", '金额≥100万元但未约定责任上限'),
    R('R010', '须包含保密条款（服务/开发类）', '保密', 'warn', "return !/服务|开发/.test(c.type) || f.confidentiality === true", '服务/开发类合同缺少保密条款'),
    R('R011', '必须约定合同期限', '期限', 'fail', 'return !!f.startDate && !!f.endDate', '缺少生效或到期日期'),
    R('R012', '自动续约须人工确认', '期限', 'warn', 'return !f.autoRenew', '合同含自动续约条款，请在到期前评估'),
    R('R013', '解除通知期不少于 30 天', '解除', 'warn', 'return !f.terminationNoticeDays || f.terminationNoticeDays >= 30', '解除通知期仅 ${f.terminationNoticeDays} 天'),
    R('R014', '开发成果知识产权归我方', '知识产权', 'fail', "return c.type !== '技术开发' || /归甲方/.test(f.ipOwnership||'')", '技术开发合同知识产权未归属甲方'),
    R('R015', '管辖法院不得为对方所在地', '法律适用', 'warn', "return !/乙方所在地/.test(f.disputeResolution||'')", '约定由对方所在地法院管辖，对我方不利')
  ]
}
