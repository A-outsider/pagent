const aliases = new Map([
  ['手机号码', ['基本信息', '电话']],
  ['手机号', ['基本信息', '电话']],
  ['联系电话', ['基本信息', '电话']],
  ['电子邮箱', ['基本信息', '邮箱']],
  ['生日', ['基本信息', '出生日期']],
  ['所在地', ['基本信息', '现居住地']],
  ['现居城市', ['基本信息', '现居住地']],
  ['目前居住地', ['基本信息', '现居住地']],
  ['学校名称', ['教育经历', '学校']],
  ['就读学校', ['教育经历', '学校']],
  ['专业名称', ['教育经历', '专业']],
  ['毕业时间', ['教育经历', '结束时间']],
  ['毕业日期', ['教育经历', '结束时间']],
  ['工作单位', ['工作经历', '公司']],
  ['公司名称', ['工作经历', '公司']],
  ['所在部门', ['工作经历', '部门']],
  ['项目职务', ['项目经历', '职位']],
  ['期望城市', ['求职意向', '期望工作城市']],
  ['期望月薪', ['求职意向', '期望薪资']],
  ['月薪期望', ['求职意向', '期望薪资']],
  ['期望月收入', ['求职意向', '期望薪资']],
  ['薪资期望', ['求职意向', '期望薪资']],
  ['期望工资', ['求职意向', '期望薪资']],
]);

// Classification applies across page sections, so scoped reads retain every rule.
// Rules are context, never additional facts or automatically generated records.
export function classificationContext(profile) {
  return Array.isArray(profile.classificationRules) ? { classificationRules: profile.classificationRules } : {};
}

function isEmpty(value) {
  return value == null
    || (typeof value === 'string' && value.trim() === '')
    || (typeof value === 'object' && Object.keys(value).length === 0);
}

function leaves(sections) {
  const result = [];
  function visit(value, path, label, section, recordIndex) {
    if (value !== null && typeof value === 'object' && !isEmpty(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
          Array.isArray(value) ? label : key, section, recordIndex);
      }
    } else {
      result.push({ label, section, recordIndex, path, value });
    }
  }
  for (const [section, value] of Object.entries(sections)) {
    if (Array.isArray(value) && value.length) {
      value.forEach((record, index) => visit(record, `sections.${section}[${index}]`, section, section, index));
    } else {
      visit(value, `sections.${section}`, section, section);
    }
  }
  return result;
}

export function lookupResumeFields(profile, fields) {
  const sections = profile.sections ?? {};
  const candidates = leaves(sections);
  const results = fields.map(({ label, section, recordIndex }) => {
    const field = { label, ...(section !== undefined && { section }), ...(recordIndex !== undefined && { recordIndex }) };
    const skip = (status, reason, details = {}) => ({ ...field, status, action: 'skip', ...details, reason });
    if (section !== undefined && !Object.hasOwn(sections, section)) {
      return skip('not_found', '指定栏目不存在；未查找其他栏目，不能据此认定该事实不存在。');
    }
    if (recordIndex !== undefined) {
      if (section === undefined) {
        return skip('ambiguous', 'recordIndex 必须与明确的 section 一起使用，无法确定要选择哪个栏目的记录。', { candidatePaths: [] });
      }
      if (!Array.isArray(sections[section]) || !Number.isInteger(recordIndex)
        || recordIndex < 0 || !Object.hasOwn(sections[section], recordIndex)) {
        return skip('not_found', '指定栏目不是记录数组或记录索引不存在；未回退到其他记录。');
      }
    }
    const scope = candidates.filter((candidate) => (section === undefined || candidate.section === section)
      && (recordIndex === undefined || candidate.recordIndex === recordIndex));
    let matches = scope.filter((candidate) => candidate.label === label);
    if (!matches.length && aliases.has(label)) {
      const [aliasSection, aliasLabel] = aliases.get(label);
      matches = scope.filter((candidate) => candidate.section === aliasSection
        && candidate.path === `sections.${aliasSection}${candidate.recordIndex === undefined ? '' : `[${candidate.recordIndex}]`}.${aliasLabel}`);
    }
    if (!matches.length) {
      return skip('not_found', '未找到有明确依据的同名字段或受支持别名；不能据此认定该事实不存在。');
    }
    if (matches.length > 1 || (recordIndex === undefined
      && matches.some((candidate) => Array.isArray(sections[candidate.section]) && sections[candidate.section].length > 1))) {
      return skip('ambiguous', '存在同名字段或多条记录，缺少足够上下文；请跳过，不能自行选择。', {
        candidatePaths: matches.map((candidate) => candidate.path),
      });
    }
    const match = matches[0];
    if (isEmpty(match.value)) {
      return skip('empty', '资料中的该字段为空，没有可填写的明确值。', { sourcePath: match.path });
    }
    return { ...field, status: 'known', action: 'fill', value: match.value, sourcePath: match.path };
  });
  const fill = results.filter((field) => field.action === 'fill').length;
  return { fields: results, summary: { fill, skip: results.length - fill }, ...classificationContext(profile) };
}

function prune(value) {
  if (isEmpty(value)) return undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => prune(item) ?? null);
    return items.every((item) => item === null) ? undefined : items;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, prune(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

export function compactResume(profile, sections) {
  const selected = Object.fromEntries(Object.entries(profile.sections ?? {})
    .filter(([section]) => !sections?.length || sections.includes(section)));
  return { metadata: profile.metadata, ...classificationContext(profile), sections: prune(selected) ?? {}, recordInventory: resumeRecordInventory({ sections: selected }) };
}

// Only short identifying facts belong in the inventory; long descriptions and
// private contact/identity fields stay in their original records.
const RECORD_IDENTIFIERS = new Set(['学校', '专业', '公司', '项目名称', '职位', '开始时间', '结束时间', '奖励名称', '获奖时间', '证书名称', '获得时间', '外语语种', '技能类型']);

export function resumeRecordInventory(profile) {
  return Object.entries(profile.sections ?? {}).flatMap(([section, value]) => {
    if (!Array.isArray(value)) return [];
    const records = value.flatMap((record, recordIndex) => {
      if (prune(record) === undefined) return [];
      const identifiers = Object.fromEntries(Object.entries(record && typeof record === 'object' ? record : {})
        .filter(([key, item]) => RECORD_IDENTIFIERS.has(key) && typeof item === 'string' && item.trim() && item.length <= 120));
      return [{ recordIndex, sourcePath: `sections.${section}[${recordIndex}]`, identifiers }];
    });
    return records.length ? [{ section, count: records.length, records }] : [];
  });
}
