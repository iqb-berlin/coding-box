export const VARIABLE_ANALYSIS_EXPORT_COLUMNS = [
  { header: 'Unit-ID', key: 'unitId', width: 12 },
  { header: 'Unit-Name', key: 'unitName', width: 24 },
  { header: 'Variablen-ID', key: 'variableId', width: 22 },
  { header: 'Auswertung', key: 'analysisMode', width: 20 },
  { header: 'Kodierlauf', key: 'codingVersion', width: 16 },
  { header: 'Antworten gesamt', key: 'totalCount', width: 18 },
  { header: 'Antworten gültig', key: 'validCount', width: 18 },
  { header: 'Fehlend/ungültig', key: 'invalidCount', width: 18 },
  { header: 'Leere Rohwerte', key: 'emptyCount', width: 14 },
  { header: 'Leere Rohwerte (%)', key: 'emptyPercentage', width: 18 },
  { header: 'Unterschiedliche Werte', key: 'distinctValueCount', width: 22 },
  { header: 'Weitere Werte nicht enthalten', key: 'hiddenValueCount', width: 28 },
  { header: 'Statusverteilung der Variable', key: 'statusSummary', width: 42 },
  { header: 'Antwortwert/Kategorie oder Code', key: 'value', width: 36 },
  { header: 'Label', key: 'label', width: 36 },
  { header: 'Code', key: 'code', width: 14 },
  { header: 'Score', key: 'score', width: 12 },
  { header: 'Zuordnung aus Kodierschema', key: 'isFromSchema', width: 28 },
  { header: 'Wert ist leer', key: 'isEmptyValue', width: 14 },
  { header: 'Anzahl Antworten', key: 'count', width: 12 },
  { header: 'Anzahl gültiger Antworten', key: 'validOccurrenceCount', width: 16 },
  { header: 'Anteil gesamt (%)', key: 'percentageTotal', width: 18 },
  { header: 'Anteil gültig (%)', key: 'percentageValid', width: 18 },
  { header: 'Punktbiseriale Korrelation', key: 'pointBiserial', width: 26 },
  { header: 'Code-PBC', key: 'codePbc', width: 14 },
  { header: 'Kategorie-PBC', key: 'categoryPbc', width: 16 },
  { header: 'Antwortposition', key: 'position', width: 16 }
] as const;

type VariableAnalysisExportColumnKey =
  typeof VARIABLE_ANALYSIS_EXPORT_COLUMNS[number]['key'];

export type VariableAnalysisExportCell = string | number;

export type VariableAnalysisExportRow = Record<
  VariableAnalysisExportColumnKey,
  VariableAnalysisExportCell
>;
