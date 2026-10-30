#' Complete design with coded responses
#'
#' @param coded Tibble. Response data coded with [eatPrepTBA::code_responses()]. The argument `prepare` must be `TRUE`.
#' @param units Tibble. Unit data retrieved from the IQB Studio after setting the argument `unit_definition = TRUE` for [get_units()] -- otherwise the page order of variables could not be correctly inferred from the variable source tree. Could already be treated by [`add_coding_scheme()`] to save some time.
#' @param design Tibble. Design retrieved from Testcenter via [get_design()] or an object formatted in the same way.
#' @param identifiers Character. Contains person identifiers of the dataset `coded`. Defaults to `c("group_id", "login_name", "login_code")` which corresponds to the identifiers of the IQB Testcenter.
#' @param overwrite Logical. Should column `unit_codes` be overwritten if they exist on `units`. Defaults to `FALSE`, i.e., `unit_codes` will be used if they were added to `units` beforehand by applying `add_coding_schemes()`.
#' @param missings Tibble (optional). Provide missing meta data with `code_id`, `code_status`, `code_score`, and `code_type`. Defaults to `NULL` and uses default scheme. The supplied `code_status` is always preserved, including `NA`; the scheme assigns analytical codes and scores only.
#' @param recode_omissions_to_not_reached Logical. Should trailing omissions (`MISSING_BY_OMISSION`) be recoded to not reached (`MISSING_NOT_REACHED`) when they occur at the end of a testlet? Defaults to `FALSE`.
#' @param preserve_not_reached Logical. Should not-reached results be protected
#' from recoding to omissions, even before later work? Defaults to `FALSE`.
#' Protects supplied `MISSING_NOT_REACHED` types, the missing scheme's NR code
#' when `code_type` is absent, and NR inferred during completion, including
#' newly completed rows with `code_status = NA`. Other supplied types take
#' precedence over a technical `NOT_REACHED` status or an NR code.
#'
#' @description
#' This function automatically completes missings for coded responses.
#'
#' @details
#' Only variables explicitly linked to items in `items_list` (or `item_metadata`
#' when `items_list` is absent), and their direct and indirect source variables,
#' can establish the not-reached boundary. Own scores and variable names do not
#' establish item relevance. After the existing code normalization, `NO_CODING`
#' never establishes this boundary, even for items or their sources.
#' Rows with a missing or blank `item_id` or `variable_id` are ignored without
#' warning; whitespace-only values are also blank. An item list with nonblank
#' item or variable identifiers but no complete links provides no boundary
#' contributors. Missing or empty metadata, all-blank placeholders, conflicting
#' complete links, or unresolvable required sources cause a unit-wide fallback:
#' all variables in that unit may establish the boundary except `NO_CODING`.
#' One aggregated warning identifies affected units. Unrelated design variables
#' absent from coding metadata do not themselves trigger this fallback. Empty
#' lists and all-blank placeholders cannot distinguish an item-free unit from
#' missing metadata.
#' This selection affects only the boundary. All design rows still receive the
#' existing missing treatment; values, technical statuses, `id_used`, and the
#' full-metadata ordering retain their previous treatment. Source evidence is
#' evaluated at the source's own position, not the derived item's position.
#'
#' Within each unit, base variables are ordered by numeric page, numeric section,
#' and natural variable name (for example, `V2` precedes `V10`). Missing sections
#' follow known sections on the same page. Variables without a finite page follow
#' known pages and are ordered by name alone.
#' Derived variables with fully resolvable sources are inserted immediately after
#' their last source, including chains of derivations. Simultaneously available
#' derivations are ordered by natural name; their newly available dependants are
#' inserted before the next sibling. Missing, ambiguous, or cyclic source links
#' use the variable's own page, section, and name instead. Source links come from
#' `variable_sources`, or from `derive_sources` when the former is empty.
#' Element position and derivation level are not additional sorting keys.
#' The trailing missing sequence is determined separately for each person,
#' booklet, and testlet, including positions within a partly answered unit.
#' Existing valid, invalid, and technical-error results retain their previous
#' treatment; derived results are not reclassified from their source variables.
#' An optional logical `coding_from_not_reached` column in `coded` records
#' results produced by treating a known not-reached state as changed for coding.
#' Only `TRUE` excludes that row from establishing the not-reached boundary;
#' `FALSE`, `NA`, and an absent column retain the usual boundary treatment.
#' This provenance does not itself change the row's code, score, or technical
#' status, and is not propagated to derived results. A column of the same name
#' in `design` is ignored; provenance is taken from `coded` only.
#' A valid derived result included in the boundary can turn preceding
#' not-reached sources into omissions unless
#' `preserve_not_reached = TRUE`. Derived missing codes still
#' follow the usual missing rules; no derivation is recalculated.
#' Newly completed rows retain `NA` in `code_status`.
#' The two missing options are independent: preserving NR does not turn inner
#' omissions into NR. With both options `TRUE`, existing and newly inferred NR
#' remain NR, and trailing omissions additionally become NR. Missing schemes
#' still assign the corresponding codes and scores.
#'
#' @return A tibble including integer `variable_position`: the one-based position
#' within `unit_key` used for sorting and missing classification, including
#' derived variables. It is calculated from the unit metadata, replacing any
#' input column of the same name. Positions can have gaps when `design` contains
#' only part of a unit; variables absent from the unit metadata receive `NA`.
#'
#' @seealso Online guides: [Standard workflow](https://iqb-research.github.io/eatPrepTBA/articles/standard-workflow.html)
#' and [Missing scenarios](https://iqb-research.github.io/eatPrepTBA/articles/missing-examples.html).
#' The online documentation may differ from the installed package version.
#' @export
complete_design <- function(coded,
                            units,
                            design,
                            identifiers = c("group_id", "login_name", "login_code"),
                            overwrite = FALSE,
                            missings = NULL,
                            recode_omissions_to_not_reached = FALSE,
                            preserve_not_reached = FALSE
) {
  # input validation
  checkmate::assert_character(identifiers)
  checkmate::assert_logical(overwrite, len = 1)
  checkmate::assert_logical(recode_omissions_to_not_reached, len = 1)
  checkmate::assert_flag(preserve_not_reached)

  checkmate::assert_tibble(design)
  identifiers <- intersect(names(design), identifiers)
  design_cols <- c(identifiers, "booklet_id", "unit_key", "unit_alias", "variable_id", "booklet_no", "testlet_no", "unit_booklet_no")
  assert_cols(design, design_cols, "design")

  checkmate::assert_tibble(coded)
  coded_cols <- c(identifiers, "unit_key", "unit_alias", "variable_id", "booklet_id", "code_status", "value", "code_id", "code_type", "code_score")
  assert_cols(coded, coded_cols, "coded")
  has_nr_provenance <- "coding_from_not_reached" %in% names(coded)
  if (has_nr_provenance) {
    checkmate::assert_logical(coded$coding_from_not_reached, any.missing = TRUE)
  }

  checkmate::assert_tibble(units)
  units_cols <- if (!overwrite && tibble::has_name(units, "unit_codes")) {
    c("unit_key", "unit_codes")
  } else {
    c("unit_key", "ws_id", "unit_id", "coding_scheme", "unit_variables")
  }
  assert_cols(units, units_cols, "units")

  checkmate::assert_tibble(missings, null.ok = TRUE)
  missings_cols <- c("code_id", "code_status", "code_score", "code_type")
  if(!is.null(missings)) assert_cols(missings, missings_cols, "missings")

  if (is.null(missings)) {
    missings <-
      tibble::tribble(
        ~code_id, ~code_status, ~code_score, ~code_type,
        -96, "NOT_REACHED", NA_real_, "MISSING_NOT_REACHED",
        -97, "CODING_ERROR", NA_real_, "MISSING_CODING_IMPOSSIBLE",
        -98, "INVALID", 0, "MISSING_INVALID_RESPONSE",
        -99, "DISPLAYED", 0, "MISSING_BY_OMISSION"
      )
  }

  missings_lookup <-
    missings %>%
    dplyr::select(
      code_type,
      missing_code_id = code_id,
      missing_code_score = code_score
    )

  not_reached_codes <- missings$code_id[missings$code_type %in% "MISSING_NOT_REACHED"]
  not_reached_codes <- not_reached_codes[!is.na(not_reached_codes)]
  if (!length(not_reached_codes)) not_reached_codes <- -96

  not_reached_tail_types <- "MISSING_NOT_REACHED"
  if (recode_omissions_to_not_reached) {
    not_reached_tail_types <- c(not_reached_tail_types, "MISSING_BY_OMISSION")
  }
  boundary_neutral_types <- c(not_reached_tail_types, "NO_CODING")

  cli_setting()

  cli::cli_h3("Preparing {.unit-label units}")
  units_cs <-
    add_coding_scheme(
      units = units,
      overwrite = overwrite,
      filter_has_codes = TRUE
    )

  units_cs_merge <-
    units_cs %>%
    dplyr::mutate(unit_codes = lapply(unit_codes, function(codes) {
      # Calculate once per unit, before expanding to people and booklets.
      if (!is.null(codes)) codes$.completion_position <- complete_design_positions(codes)
      codes
    })) %>%
    dplyr::select(
      unit_key, unit_codes
    ) %>%
    tidyr::unnest(unit_codes) %>%
    dplyr::select(dplyr::any_of(c(
      "unit_key", "variable_id", "variable_source_type",
      "variable_level", "variable_page", "variable_section", "variable_page_always_visible",
      ".completion_position"
    )))

  # Preserve joins for absent schemes; membership then falls back for that unit.
  if (!"variable_id" %in% names(units_cs_merge)) {
    units_cs_merge$variable_id <- design$variable_id[rep(NA_integer_, nrow(units_cs_merge))]
  }
  if (!".completion_position" %in% names(units_cs_merge)) {
    units_cs_merge$.completion_position <- rep(NA_integer_, nrow(units_cs_merge))
  }
  units_cs_merge <- dplyr::full_join(
    units_cs_merge, complete_design_boundary(units_cs, design),
    by = dplyr::join_by(unit_key, variable_id)
  )

  # Merge codes and design
  design_coded <-
    design %>%
    dplyr::select(-dplyr::any_of(c("variable_position", "coding_from_not_reached"))) %>%
    dplyr::mutate(
      booklet_merge = stringr::str_to_upper(booklet_id)
    ) %>%
    dplyr::left_join(
      coded %>% dplyr::mutate(booklet_merge = stringr::str_to_upper(booklet_id)) %>%
        dplyr::select(-booklet_id, -dplyr::any_of("variable_position")),
      by = dplyr::join_by(!!! c(identifiers, "booklet_merge", "unit_key", "unit_alias", "variable_id"))
    ) %>%
    dplyr::select(-dplyr::any_of(c("variable_source_type"))) %>%
    dplyr::left_join(units_cs_merge,
                     by = dplyr::join_by("unit_key", "variable_id")) %>%
    dplyr::group_by(
      dplyr::across(dplyr::any_of(identifiers))
    ) %>%
    dplyr::mutate(
      id_used = !all(is.na(code_status))
    ) %>%
    dplyr::ungroup()

  design_missings <-
    design_coded %>%
    dplyr::mutate(
      # TODO: Diese Korrektur nach Auto-Coder-Fix entfernen!
      code_type = dplyr::case_when(
        # A previous O -> NR recode may still carry the technical DISPLAYED status.
        .env$preserve_not_reached &
          (code_type %in% "MISSING_NOT_REACHED" |
             (is.na(code_type) & code_id %in% .env$not_reached_codes))
          ~ "MISSING_NOT_REACHED",
        # -99 mbo: Omissions (needs to be recoded with -99)
        # Real omissions, flagged by manual coding
        (is.na(value) | code_id == -99) & code_status == "DISPLAYED" ~ "MISSING_BY_OMISSION",
        # Omissions found by the Studio
        is.na(code_type) & code_status %in% c("DISPLAYED", "PARTLY_DISPLAYED") ~ "MISSING_BY_OMISSION",
        # -98 mir: Invalid responses due to derivation (e.g., numbers in solver) or manual coding
        is.na(code_type) & code_status %in% c("INVALID", "DERIVE_ERROR") ~ "MISSING_INVALID_RESPONSE",
        # -97 mci: Coding errors und Coding impossible
        is.na(code_type) & code_status == "CODING_ERROR" ~ "MISSING_CODING_IMPOSSIBLE",
        # -96 mnr: Not reached (needs to be recoded with -99)
        is.na(code_type) & (code_status == "NOT_REACHED" | is.na(code_status)) ~ "MISSING_NOT_REACHED",
        # -93 mnc: No codes available -- reserviere -94 für Missing By Design
        is.na(code_type) & code_status == "NO_CODING" ~ "NO_CODING",
        # -90: Coding incomplete
        code_status %in% c("CODING_INCOMPLETE", "DERIVE_PENDING", "INTENDED_INCOMPLETE") ~ code_status,
        .default = code_type
      ),
      code_id = dplyr::case_when(
        code_type == "MISSING_BY_OMISSION" ~ -99,
        code_type == "MISSING_INVALID_RESPONSE" ~ -98,
        code_type == "MISSING_CODING_IMPOSSIBLE" ~ -97,
        code_type == "MISSING_NOT_REACHED" ~ -96,
        code_type == "INTENDED_INCOMPLETE" ~ -95,
        code_type == "NO_CODING" ~ -93,
        # Should not be in the final dataset after manual coding!
        code_type %in% c("CODING_INCOMPLETE", "DERIVE_PENDING") ~ -90,

        .default = code_id
      )
    )

  # A code produced from NR cannot demonstrate later work. Preserve the
  # result itself, and do not infer this provenance from values or descendants.
  if (has_nr_provenance) {
    design_missings$.completion_boundary <-
      design_missings$.completion_boundary &
      !(design_missings$coding_from_not_reached %in% TRUE)
  }

  not_reached_classification <-
    design_missings %>%
    dplyr::group_by(dplyr::across(
      dplyr::any_of(c(
        identifiers, "booklet_merge", "booklet_no", "testlet_no", "unit_booklet_no",
        "unit_key", "unit_alias"
      ))
    )) %>%
    dplyr::summarise(
      not_reach = all(!.data$.completion_boundary |
                       code_type %in% boundary_neutral_types | is.na(code_type)),
      last_position = max(c(0L, .data$.completion_position[
        .data$.completion_boundary &
          !(code_type %in% boundary_neutral_types | is.na(code_type))
      ]), na.rm = TRUE),
      .groups = "drop"
    )

  not_reached_cases <-
    not_reached_classification %>%
    dplyr::group_by(dplyr::across(
      dplyr::any_of(c(
        identifiers, "booklet_merge", "booklet_no", "testlet_no"
      ))
    )) %>%
    dplyr::arrange(dplyr::across(dplyr::any_of(c(identifiers, "booklet_merge", "booklet_no", "testlet_no"))), dplyr::desc(unit_booklet_no)) %>%
    dplyr::mutate(
      nr = dplyr::cumall(not_reach),
      # Da es keine Unit danach mehr geben kann, wird sie diese hypothetische Unit als NOT_REACHED behandelt
      lag_nr = dplyr::lag(nr, default = TRUE),
      check_nr = nr | lag_nr
    ) %>%
    dplyr::ungroup()

  design_missings %>%
    dplyr::left_join(
      not_reached_cases,
      by = dplyr::join_by(!!! identifiers, "booklet_merge", "booklet_no", "testlet_no", "unit_booklet_no", "unit_key", "unit_alias")
    ) %>%
    dplyr::mutate(
      code_type = dplyr::case_when(
        # Protect supplied and inferred NR, including rows completed from design.
        .env$preserve_not_reached & code_type %in% "MISSING_NOT_REACHED"
          ~ "MISSING_NOT_REACHED",
        # Keep the unit-level boundary, but exclude positions before later work.
        (code_type %in% not_reached_tail_types | is.na(code_type)) &
          check_nr & (is.na(.data$.completion_position) |
                        .data$.completion_position >= .data$last_position)
          ~ "MISSING_NOT_REACHED",
        # Kodiert andernfalls auf -99
        (code_type %in% not_reached_tail_types | is.na(code_type))
        ~  "MISSING_BY_OMISSION",
        .default = code_type),
      code_id = dplyr::case_when(
        code_type == "MISSING_NOT_REACHED" & (is.na(code_id) | code_id != -96) ~ -96,
        code_type == "MISSING_BY_OMISSION" & (is.na(code_id) | code_id != -99) ~ -99,
        .default = code_id
      ),
      code_score = dplyr::case_when(
        code_id %in% c(-99, -98) ~ 0,
        code_id %in% c(-97, -96, -95, -93, -90) ~ NA,
        .default = code_score
      )
    ) %>%
    dplyr::left_join(
      missings_lookup,
      by = dplyr::join_by("code_type")
    ) %>%
    dplyr::mutate(
      code_id = dplyr::coalesce(missing_code_id, code_id),
      code_score = dplyr::coalesce(missing_code_score, code_score)
    ) %>%
    dplyr::arrange(dplyr::across(
      dplyr::any_of(c(
        identifiers, "booklet_no", "booklet_merge", "testlet_no", "unit_booklet_no", ".completion_position"
      ))
    )) %>%
    dplyr::select(
      -dplyr::any_of(c(
        "not_reach", "nr", "lag_nr", "check_nr", "last_position",
        "missing_code_id", "missing_code_score", ".completion_boundary"
      ))
    ) %>%
    dplyr::rename(variable_position = ".completion_position")
}

# Static ordering of one unit; no response values or person-specific data enter.
complete_design_positions <- function(codes) {
  n <- nrow(codes)
  if (!n) return(integer())
  ids <- as.character(codes$variable_id)
  names_sorted <- stringr::str_sort(sort(unique(ids), method = "radix"),
                                   numeric = TRUE, locale = "en")
  name_rank <- match(ids, names_sorted)
  numeric_position <- function(column) {
    x <- if (column %in% names(codes)) {
      suppressWarnings(as.numeric(as.character(codes[[column]])))
    } else rep(NA_real_, n)
    x[!is.finite(x)] <- NA_real_
    x
  }
  page <- numeric_position("variable_page")
  section <- numeric_position("variable_section")
  section[is.na(page)] <- NA_real_
  fallback <- order(page, section, name_rank, na.last = TRUE)
  sources <- rep(list(integer()), n)
  refs <- if ("variable_ref" %in% names(codes)) as.character(codes$variable_ref) else NULL
  # An ambiguous identifier cannot identify a source. Build the lookup keys
  # once, rather than checking all unit keys again for every derivation.
  id_keys <- ids
  id_keys[duplicated(ids) | duplicated(ids, fromLast = TRUE)] <- NA_character_
  if (!is.null(refs)) refs[duplicated(refs) | duplicated(refs, fromLast = TRUE)] <- NA_character_
  resolve <- function(values, keys) {
    values <- as.character(unlist(values, use.names = FALSE))
    if (!length(values) || anyNA(values) || any(!nzchar(values)) || is.null(keys)) {
      return(integer())
    }
    at <- match(values, keys)
    if (anyNA(at)) return(integer())
    unique(at)
  }
  for (i in seq_len(n)) {
    if ("variable_source_type" %in% names(codes) &&
        codes$variable_source_type[i] %in% c("BASE", "BASE_NO_VALUE")) next
    src <- if ("variable_sources" %in% names(codes)) codes$variable_sources[[i]] else NULL
    if (is.data.frame(src) && nrow(src)) {
      if ("variable_source_direct" %in% names(src)) {
        direct <- src$variable_source_direct
        if (!is.logical(direct) || anyNA(direct)) next
        if (any(direct)) src <- src[direct, , drop = FALSE]
      }
      sources[[i]] <- if ("variable_source_ref" %in% names(src) && !is.null(refs)) {
        resolve(src$variable_source_ref, refs)
      } else if ("variable_source_id" %in% names(src)) {
        resolve(src$variable_source_id, id_keys)
      } else integer()
    } else if ((length(src) == 0L || (is.data.frame(src) && nrow(src) == 0L)) &&
               "derive_sources" %in% names(codes)) {
      sources[[i]] <- resolve(codes$derive_sources[[i]], refs)
    }
  }
  if (!any(lengths(sources))) return(order(fallback))

  # A topological pass identifies cycles and their blocked dependants. Their
  # source links are discarded together, so each uses its own fallback position.
  dependants <- split(rep(seq_len(n), lengths(sources)),
                      factor(unlist(sources, use.names = FALSE), levels = seq_len(n)))
  remaining <- lengths(sources)
  queue <- integer(n)
  roots <- which(remaining == 0L)
  tail <- length(roots)
  queue[seq_len(tail)] <- roots
  head <- 1L
  while (head <= tail) {
    children <- dependants[[queue[head]]]
    remaining[children] <- remaining[children] - 1L
    ready <- children[remaining[children] == 0L]
    if (length(ready)) {
      queue[tail + seq_along(ready)] <- ready
      tail <- tail + length(ready)
    }
    head <- head + 1L
  }
  blocked <- which(remaining > 0L)
  if (length(blocked)) {
    sources[blocked] <- rep(list(integer()), length(blocked))
    dependants <- split(rep(seq_len(n), lengths(sources)),
                        factor(unlist(sources, use.names = FALSE), levels = seq_len(n)))
  }

  # Walk roots in layout order. Newly available derivations go on the stack
  # before pending siblings, keeping chains next to their sources without recursion.
  remaining <- lengths(sources)
  roots <- fallback[remaining[fallback] == 0L]
  stack <- integer(n)
  top <- length(roots)
  stack[seq_len(top)] <- rev(roots)
  position <- integer(n)
  next_position <- 0L
  while (top > 0L) {
    i <- stack[top]
    top <- top - 1L
    next_position <- next_position + 1L
    position[i] <- next_position
    children <- dependants[[i]]
    remaining[children] <- remaining[children] - 1L
    ready <- children[remaining[children] == 0L]
    if (length(ready)) {
      ready <- ready[order(name_rank[ready], decreasing = TRUE)]
      stack[top + seq_along(ready)] <- ready
      top <- top + length(ready)
    }
  }
  position
}
