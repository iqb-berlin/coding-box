# Kleine, vollständig synthetische Daten passend zur Rechenaufgabe im Tutorial.
# Nur Autor:innen benötigen dieses Skript. Es ändert nicht die Hauptstudie.
# Quelle: IQB Methods, Partial-Credit-Anleitung von Eva Crone, Abschnitt 2.3.

library(eatPrepTBA)
library(dplyr)
library(tibble)

pc_json <- function(x) {
  as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null"))
}

pc_code <- function(id, score, type, label, solution = NULL) {
  rules <- list()
  if (!is.null(solution)) {
    rules <- list(list(ruleOperatorAnd = TRUE, rules = list(list(
      method = "NUMERIC_MATCH", parameters = list(as.character(solution))
    ))))
  }
  list(id = id, score = score, type = type, label = label,
       manualInstruction = label, ruleSetOperatorAnd = FALSE, ruleSets = rules)
}

pc_variable <- function(id, label, solution = NULL, derived = FALSE) {
  codes <- if (derived) {
    list(pc_code(1L, 2, "FULL_CREDIT", "Drei Antworten richtig", 3),
         pc_code(2L, 1, "PARTIAL_CREDIT", "Zwei Antworten richtig", 2),
         pc_code(0L, 0, "RESIDUAL_AUTO", "Hoechstens eine Antwort richtig"))
  } else {
    list(pc_code(if (id == "01c") 11L else 1L, 1,
                 "FULL_CREDIT", "Richtige Zahl", solution),
         pc_code(0L, 0, "RESIDUAL_AUTO", "Andere Zahl"))
  }
  list(id = id, alias = id, label = label,
       sourceType = if (derived) "SUM_SCORE" else "BASE",
       sourceParameters = list(solverExpression = "", processing = list()),
       deriveSources = if (derived) list("01a", "01b", "01c") else list(),
       processing = if (derived) list() else list(
         "TAKE_DISPLAYED_AS_VALUE_CHANGED", "TAKE_EMPTY_AS_VALID"),
       fragmenting = "", manualInstruction = label, codeModel = "NONE",
       page = "1", codes = codes)
}

pc_variables <- list(pc_variable("01a", "10 + 11", 21),
                     pc_variable("01b", "11 + 101", 112),
                     pc_variable("01c", "101 + 1001", 1102),
                     pc_variable("01", "Rechenpaeckchen", derived = TRUE))

pc_scheme <- pc_json(list(variableCodings = pc_variables, version = "3.0"))
pc_units <- tibble(
  ws_id = 1L, ws_label = "Synthetisches Tutorialbeispiel", unit_id = 1L,
  unit_key = "PC_RECHNEN", unit_label = "Rechenpaeckchen",
  coding_scheme = pc_scheme,
  unit_variables = list(tibble(
    variable_id = c("01a", "01b", "01c"),
    variable_ref = c("01a", "01b", "01c"),
    variable_type = "string", variable_format = "", variable_multiple = FALSE,
    variable_page = 1L,
    variable_values = rep(list(tibble(value = NA_character_,
                                     value_label = NA_character_)), 3L))),
  items_list = list(tibble(item_no = 1L, variable_id = "01",
                          variable_ref = "01", item_id = "RECHNEN_01"))
)
pc_units <- add_coding_scheme(pc_units)
saveRDS(pc_units, "Daten/demo-pc-units.rds")

# Antworten sind absichtlich vorgegeben: 3, 2, 1 und 0 richtige Eingaben.
pc_values <- list(c("21", "112", "1102"), c("21", "112", "1103"),
                  c("21", "113", "1103"), c("22", "113", "1103"))
pc_raw_json <- vapply(pc_values, function(values) {
  pc_json(lapply(seq_along(values), function(i) {
    list(id = c("01a", "01b", "01c")[[i]], value = values[[i]],
         status = "VALUE_CHANGED")
  }))
}, character(1))

pc_export <- tibble(
  groupname = "DEMO", loginname = paste0("D", 1:4),
  code = paste0("DEMO", 1:4), bookletname = "DEMO_BOOKLET",
  unitname = "PC_RECHNEN", originalUnitId = "PC_RECHNEN",
  responses = vapply(pc_raw_json, function(payload) {
    pc_json(list(list(id = "elementCodes", content = payload, ts = 1000),
                 list(id = "stateVariableCodes", content = "[]", ts = 1000)))
  }, character(1)),
  laststate = pc_json(list(list(PLAYER = "RUNNING",
    RESPONSE_PROGRESS = "complete", PRESENTATION_PROGRESS = "complete")))
)
readr::write_delim(pc_export, "Daten/demo-pc-responses.csv", delim = ";")

# Zweiter Exportfall: Codes und Scores wurden schon vom Player gespeichert.
# Nachgebildetes Format, kein Export einer echten StarS-Erhebung.
pc_stored_export <- pc_export
pc_stored_export$responses <- vapply(seq_along(pc_values), function(i) {
  existing <- pc_json(list(list(id = "01", value = as.character(4L - i),
    code = c(1L, 2L, 0L, 0L)[[i]], score = c(2, 1, 0, 0)[[i]],
    status = "CODING_COMPLETE")))
  pc_json(list(list(id = "elementCodes", content = pc_raw_json[[i]], ts = 1000),
               list(id = "responses", content = existing, ts = 1000),
               list(id = "stateVariableCodes", content = "[]", ts = 1000)))
}, character(1))
readr::write_delim(pc_stored_export, "Daten/demo-stored-codes.csv", delim = ";")

# Vorbereitete Auszüge: keine echten API-Abrufe und keine simulierten Funktionen.
# Struktur von add_metadata(): Unit-Metadaten und Item-Metadaten als Listenspalten.
metadata_demo <- tibble(
  ws_id = 1L, unit_id = 1L, unit_key = "PC_RECHNEN",
  unit_label = "Rechenpaeckchen",
  unit_metadata = list(tibble(Fach = "Mathematik", Klassenstufe = "4")),
  item_metadata = list(tibble(item_no = 1L, variable_id = "01",
    variable_ref = "01", item_id = "RECHNEN_01",
    Kompetenz = "Zahlen und Operationen"))
)
saveRDS(metadata_demo, "Daten/demo-metadata-prepared.rds")

# Struktur von get_coding_report(); der zweite Fall ist unabhängig von pc_units.
# Studio verwendet OK, Warnung oder Fehler; Details stehen in validationProblems.
empty_problems <- tibble(type = character(), breaking = logical(),
                         code = character())
coding_report_demo <- tibble(
  ws_id = "1", unit_id = c(1L, 2L),
  unit_key = c("PC_RECHNEN", "DEMO_PRUEFFALL"),
  unit_label = c("Rechenpaeckchen", "Absichtlicher Prueffall"),
  variable_id = c("01", "SUMME"), item = c("RECHNEN_01", "PRUEFFALL_01"),
  validation = c("OK", "Fehler"),
  validation_problems = list(empty_problems,
    tibble(type = "SOURCE_MISSING", breaking = TRUE, code = NA_character_)),
  coding_type = c("automatisch", "automatisch")
)
saveRDS(coding_report_demo, "Daten/demo-coding-report.rds")

cat("Demo erzeugt: 1 Unit, 3 Basisvariablen, 1 Item und 4 Personen.\n")
