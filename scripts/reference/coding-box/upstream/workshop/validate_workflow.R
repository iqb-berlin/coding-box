# Interne Prüfung der synthetischen Workshop-Lehrfälle.
# Aus dem Projektordner ausführen. Nicht als Vorlage für eigene Daten gedacht.
source("Syntaxen/03_datenaufbereitung.R", encoding = "UTF-8")

case <- function(person, unit, variable) {
  dplyr::filter(design_coded, login_name == person,
                unit_key == unit, variable_id == variable)
}

# Umfang der unabhängig festgelegten Mini-Studie.
item_columns <- setdiff(names(scaling_data), person_columns)
persons <- distinct(item_data, group_id, login_name, login_code)
stopifnot(nrow(unresolved) == 0L, nrow(scaling_data) == nrow(persons))
stopifnot(all(vapply(scaling_data[item_columns], is.numeric, logical(1))))
stopifnot(nrow(units) == 6L, nrow(design) == 340L, nrow(responses) == 193L)
stopifnot(nrow(scaling_data) == 39L, ncol(scaling_data) == 11L)
stopifnot(length(item_columns) == 8L)
stopifnot(setequal(item_columns, c("U101", "U102", "U201", "U301",
                                  "U401", "U501", "U502", "U601")))
stopifnot(!anyDuplicated(item_data[c(person_columns, "item")]))

# Die Freitexte in der manuellen Tabelle stammen aus denselben Rohantworten.
manual_keys <- c(response_keys, "variable_id")
response_values <- prepare_responses(responses) |>
  filter(unit_key == "U4", variable_id == "TEXT") |>
  transmute(across(all_of(manual_keys)),
            response_value = vapply(value, function(x) unlist(x), character(1)))
manual_values <- codes_manual |>
  transmute(across(all_of(manual_keys)), manual_value = coalesce(value, ""))
value_check <- full_join(manual_values, response_values, by = manual_keys,
                         relationship = "one-to-one")
stopifnot(nrow(value_check) == 39L)
stopifnot(identical(value_check$manual_value, value_check$response_value))
stopifnot(n_distinct(value_check$response_value[value_check$response_value != ""]) == 6L)
stopifnot(case("P001", "U4", "TEXT")$code_score == 0.5)
stopifnot(case("P002", "U4", "TEXT")$code_score == 1)
stopifnot(case("P003", "U4", "TEXT")$code_score == 0)

# Innere Auslassung, Not reached, ungültige Antwort und manuelle Auslassung.
stopifnot(case("P002", "U2", "Q1")$code_type == "MISSING_BY_OMISSION")
stopifnot(case("P003", "U5", "Q1")$code_type == "MISSING_NOT_REACHED")
stopifnot(case("P004", "U1", "Q1")$code_type == "MISSING_INVALID_RESPONSE")
stopifnot(case("P005", "U4", "TEXT")$code_id == -99L)
stopifnot(case("P006", "U5", "Q1")$code_type == "MISSING_BY_OMISSION")
stopifnot(all(is.na(case("P003", "U5", "Q1")$code_score)))

# Die Person ohne gespeicherte Antwort bleibt im Design, nicht im Export.
stopifnot(!any(dplyr::filter(design_coded, login_name == "P040")$id_used))
stopifnot(!"P040" %in% scaling_data$login_name)
stopifnot(is.na(dplyr::filter(scaling_data, login_name == "P001")$U601))
stopifnot(all(na.omit(unlist(scaling_data[item_columns])) %in% c(0, 0.5, 1)))

# Die erste Option ändert P006, die zweite unabhängig davon P002.
reclassified <- dplyr::filter(omissions_reclassified, login_name == "P006",
                              unit_key == "U5", variable_id == "Q1")
stopifnot(reclassified$code_type == "MISSING_NOT_REACHED")
stopifnot(is.na(reclassified$code_score))
preserved <- dplyr::filter(not_reached_preserved, login_name == "P002",
                           unit_key == "U2", variable_id == "Q1")
stopifnot(preserved$code_id == -96L, is.na(preserved$code_score))
stopifnot(is.na(preserved$code_status))
stopifnot(dplyr::filter(omissions_reclassified, login_name == "P002",
                       unit_key == "U2")$code_id == -99L)
stopifnot(all(dplyr::filter(not_reached_preserved, login_name == "P006",
                          unit_key == "U5")$code_id == -99L))

# Die Zusammenfassung zählt Items, nicht die zusätzlichen Basisvariablen.
stopifnot(nrow(missing_summary) == 40L, nrow(missing_summary_used) == 39L)
stopifnot(dplyr::filter(missing_summary, login_name == "P001")$n_items == 7L)
stopifnot(dplyr::filter(missing_summary, login_name == "P021")$n_items == 6L)
stopifnot(dplyr::filter(missing_summary, login_name == "P003")$n_not_reached == 2L)
stopifnot(dplyr::filter(missing_summary, login_name == "P002")$n_by_omission == 1L)

# Das MC-Beispiel trennt Antwortkategorien, Codes und Punktzahlen.
categories_by_id <- arrange(category_stats, category_id)
stopifnot(identical(categories_by_id$category_id, c("A", "B", "C")))
stopifnot(all(categories_by_id$category_n == c(21, 5, 12)))
stopifnot(all(code_stats_mc$code_id == c(-98, 0, 1)))
stopifnot(all(code_stats_mc$code_n == c(1, 17, 21)))
stopifnot(all(score_stats$code_score == c(0, 1)))
stopifnot(all(score_stats$score_n == c(18, 21)))
stopifnot(!any(grepl("^score_", names(psychometrics))))
stopifnot(isTRUE(all.equal(sum(category_stats$category_p_valid), 38 / 39)))

# Der vollständige Export erhält Kennwerte und die ursprüngliche Zeilenstruktur.
exported_stats <- read.csv2("Daten/Ergebnisse/psychometrics.csv", na.strings = "",
                            colClasses = c(item_id = "character"))
expected_stats_columns <- c(
  "unit_key", "variable_id", "item", "item_id", "variable_source_type",
  "code_id", "code_type", "code_score", "code_n", "code_n_total",
  "code_n_valid", "code_p_total", "code_p_valid", "code_pbc", "category_id",
  "category_label", "category_n", "category_p_total", "category_p_valid",
  "category_pbc", "domain")
stopifnot(setequal(names(exported_stats), expected_stats_columns))
stopifnot(nrow(exported_stats) == 37L, ncol(exported_stats) == 21L)
stopifnot(setequal(na.omit(exported_stats$item), item_columns))
stopifnot(any(exported_stats$unit_key == "U3" & is.na(exported_stats$item)))
stopifnot(isTRUE(all.equal(exported_stats, as.data.frame(psychometrics),
                           check.attributes = FALSE)))
stopifnot(identical(readRDS("Daten/Ergebnisse/psychometrics.rds"), psychometrics))

# U501: 20 vorgesehene Fälle; Not reached fehlt im Nenner der gültigen Scores.
stopifnot(all(denominator_stats$code_n_total == 20L),
          all(denominator_stats$code_n_valid == 19L))
right <- filter(proportion_stats, code_id == 1)
stopifnot(right$code_n == 6L, right$code_p_total == 6 / 20,
          right$code_p_valid == 6 / 19)
stopifnot(is.na(filter(proportion_stats, code_id == -96)$code_p_valid))
distractor_b <- filter(category_details, category_id == "B")
stopifnot(distractor_b$category_n == 7L,
          distractor_b$category_p_total == 7 / 20,
          distractor_b$category_p_valid == 7 / 19)

# Der CSV-Export erhält die Werte und die Zuordnung zu den Personen.
exported <- read.csv2("Daten/Ergebnisse/scaling_data.csv", na.strings = "")
stopifnot(identical(names(exported), names(scaling_data)))
stopifnot(isTRUE(all.equal(as.data.frame(exported), as.data.frame(scaling_data),
                           check.attributes = FALSE)))
csv_lines <- readLines("Daten/Ergebnisse/scaling_data.csv")
stopifnot(grepl(';', csv_lines[1], fixed = TRUE),
          any(grepl('0,5', csv_lines, fixed = TRUE)))
stopifnot(identical(readRDS("Daten/Ergebnisse/05_scaling_data.rds"), scaling_data))
stopifnot(!anyDuplicated(scaling_data[person_columns]))

# Fehlende Werte erscheinen in allen CSV-Ausgaben als leere Zellen.
csv_tables <- list(missing_summary = missing_summary, psychometrics = psychometrics,
                   scaling_data = scaling_data, missing_counts = missing_counts)
for (name in names(csv_tables)) {
  csv_path <- file.path("Daten/Ergebnisse", paste0(name, ".csv"))
  cells <- read.csv2(csv_path, colClasses = "character", na.strings = character())
  expected <- as.data.frame(csv_tables[[name]])
  stopifnot(identical(dim(cells), dim(expected)), identical(names(cells), names(expected)))
  stopifnot(all(as.matrix(cells)[is.na(expected)] == ""))
}

report <- c("Workshop-Lehrfälle und Export erfolgreich geprüft.",
            paste("eatPrepTBA:", packageVersion("eatPrepTBA")),
            paste("Personen im Export:", nrow(scaling_data)),
            paste("Itemspalten:", length(item_columns)))
writeLines(report, "Daten/Ergebnisse/validation.txt", useBytes = TRUE)
capture.output(sessionInfo(), file = "Daten/Ergebnisse/session-info.txt")
cat("Workshop-Lehrfälle und Export erfolgreich geprüft.\n")
