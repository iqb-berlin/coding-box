function parseProcessorList(value?: string): Set<string> | null {
  if (!value) {
    return null;
  }

  const names = value
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  return names.length ? new Set(names) : null;
}

export function getEnabledProcessorNames<T extends string>(
  allProcessorNames: readonly T[],
  enabledValue = process.env.JOB_QUEUE_PROCESSORS,
  disabledValue = process.env.DISABLED_JOB_QUEUE_PROCESSORS
): T[] {
  const enabled = parseProcessorList(enabledValue);
  const disabled = parseProcessorList(disabledValue) || new Set<string>();

  if (enabled?.has('none')) {
    return [];
  }

  const selectedNames = !enabled || enabled.has('all') ?
    allProcessorNames :
    allProcessorNames.filter(name => enabled.has(name));

  return selectedNames.filter(name => !disabled.has(name));
}
