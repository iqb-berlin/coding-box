# Static boundary membership, prepared once per unit rather than per response.
# Unknown membership permits the whole unit; it must never invent extra NR.
complete_design_boundary <- function(units, design) {
  keys <- dplyr::distinct(design, unit_key, variable_id)
  keys$.completion_boundary <- TRUE
  unit_keys <- unique(keys$unit_key)
  groups <- split(seq_len(nrow(keys)), match(keys$unit_key, unit_keys))
  at <- match(unit_keys, units$unit_key)
  duplicated_units <- units$unit_key[duplicated(units$unit_key)]
  metadata <- intersect(c("items_list", "item_metadata"), names(units))
  reasons <- rep(NA_character_, length(unit_keys))

  for (i in seq_along(unit_keys)) {
    rows <- groups[[as.character(i)]]
    if (is.na(at[i]) || is.na(unit_keys[i])) {
      reasons[i] <- "unit metadata missing"
    } else if (unit_keys[i] %in% duplicated_units) {
      reasons[i] <- "unit metadata is not unique"
    } else if (!length(metadata) || !is.list(units[[metadata[1L]]])) {
      reasons[i] <- "item metadata missing"
    } else {
      result <- complete_design_item_sources(
        units$unit_codes[[at[i]]], units[[metadata[1L]]][[at[i]]],
        keys$variable_id[rows]
      )
      if (is.character(result)) reasons[i] <- result else {
        keys$.completion_boundary[rows] <- result
      }
    }
  }
  uncertain <- !is.na(reasons)
  if (any(uncertain)) {
    details <- paste0(as.character(unit_keys[uncertain]), ": ", reasons[uncertain])
    cli::cli_warn(c(
      "Item/source relevance is uncertain for {sum(uncertain)} unit{?s}.",
      "i" = "All variables in these units may set the not-reached boundary; {.code NO_CODING} remains neutral.",
      "i" = paste(details, collapse = "; ")
    ), class = "eatPrepTBA_item_boundary_fallback")
  }
  keys
}

# Return membership for the design variables, or a reason for unit-wide fallback.
complete_design_item_sources <- function(codes, items, design_ids) {
  missing_key <- function(x) is.na(x) | !nzchar(trimws(as.character(x)))
  if (!is.data.frame(items) || !nrow(items)) return("no usable item mapping")
  if (!all(c("variable_id", "item_id") %in% names(items))) {
    return("incomplete item metadata")
  }
  has_variable <- !missing_key(items$variable_id)
  has_item <- !missing_key(items$item_id)
  # Missing metadata is represented by an empty placeholder by read_items_list().
  if (!any(has_variable | has_item)) return("item metadata contains only empty placeholders")
  # Unlinked entries are intentional. Only complete pairs start the source search.
  items <- items[has_variable & has_item, , drop = FALSE]
  if (!nrow(items)) return(rep(FALSE, length(design_ids)))
  mapping <- unique(data.frame(variable_id = as.character(items$variable_id),
                               item_id = as.character(items$item_id)))
  if (anyDuplicated(mapping$variable_id)) return("conflicting item mapping")
  if (!is.data.frame(codes) || !"variable_id" %in% names(codes)) {
    return("coding metadata missing")
  }
  ids <- as.character(codes$variable_id)
  id_keys <- ids
  id_keys[missing_key(ids) | duplicated(ids) | duplicated(ids, fromLast = TRUE)] <- NA_character_
  targets <- match(mapping$variable_id, id_keys)
  if (anyNA(targets)) {
    return("mapped item variables missing or ambiguous in coding metadata")
  }
  refs <- if ("variable_ref" %in% names(codes)) as.character(codes$variable_ref) else NULL
  ref_keys <- refs
  if (!is.null(ref_keys)) {
    ref_keys[missing_key(refs) | duplicated(refs) | duplicated(refs, fromLast = TRUE)] <- NA_character_
  }
  resolve <- function(values, lookup) {
    values <- as.character(unlist(values, use.names = FALSE))
    if (!length(values) || any(missing_key(values)) || is.null(lookup)) return(NULL)
    found <- match(values, lookup)
    if (anyNA(found)) NULL else unique(found)
  }

  # Check an explicitly supplied item reference too, without inventing aliases.
  if ("variable_ref" %in% names(items) && !is.null(refs)) {
    present <- !missing_key(items$variable_ref)
    by_ref <- match(as.character(items$variable_ref[present]), ref_keys)
    by_id <- match(as.character(items$variable_id[present]), id_keys)
    if (anyNA(by_ref) || any(by_ref != by_id)) return("conflicting item references")
  }

  sources <- rep(list(integer()), length(ids))
  included <- rep(FALSE, length(ids))
  included[targets] <- TRUE
  queue <- unique(targets)
  head <- 1L
  while (head <= length(queue)) {
    i <- queue[head]
    head <- head + 1L
    if (is.na(id_keys[i])) return("missing or ambiguous required variable identifiers")
    type <- if ("variable_source_type" %in% names(codes)) codes$variable_source_type[i] else NA_character_
    # Prepared BASE rows may carry synthetic NA source rows, not dependencies.
    if (type %in% c("BASE", "BASE_NO_VALUE")) next
    src <- if ("variable_sources" %in% names(codes)) codes$variable_sources[[i]] else NULL
    resolved <- NULL
    if (is.data.frame(src) && nrow(src)) {
      if ("variable_source_direct" %in% names(src)) {
        direct <- src$variable_source_direct
        if (!is.logical(direct) || anyNA(direct)) return("unclear source relationships")
        if (any(direct)) src <- src[direct, , drop = FALSE]
      }
      has_ref <- "variable_source_ref" %in% names(src)
      has_id <- "variable_source_id" %in% names(src)
      if (has_ref && !is.null(refs)) {
        resolved <- resolve(src$variable_source_ref, ref_keys)
        # IDs may be omitted, but a supplied conflicting ID is not safe to ignore.
        if (!is.null(resolved) && has_id) {
          present <- !missing_key(src$variable_source_id)
          by_id <- match(as.character(src$variable_source_id[present]), id_keys)
          by_ref <- match(as.character(src$variable_source_ref[present]), ref_keys)
          if (anyNA(by_id) || any(by_id != by_ref)) return("conflicting source identifiers")
        }
      } else if (has_id) resolved <- resolve(src$variable_source_id, id_keys)
    } else if (length(src) == 0L || (is.data.frame(src) && !nrow(src))) {
      if ("derive_sources" %in% names(codes)) {
        resolved <- resolve(codes$derive_sources[[i]], ref_keys)
      }
    }
    if (is.null(resolved)) return("missing or unresolvable sources")
    sources[[i]] <- resolved
    newly_included <- resolved[!included[resolved]]
    included[newly_included] <- TRUE
    queue <- c(queue, newly_included)
  }

  # Cycles cannot establish a reliable closure. Use an iterative topological pass.
  dependants <- split(rep(seq_along(ids), lengths(sources)),
                      factor(unlist(sources, use.names = FALSE), levels = seq_along(ids)))
  remaining <- lengths(sources)
  queue <- which(included & remaining == 0L)
  head <- 1L
  while (head <= length(queue)) {
    children <- dependants[[queue[head]]]
    remaining[children] <- remaining[children] - 1L
    queue <- c(queue, children[remaining[children] == 0L])
    head <- head + 1L
  }
  if (any(remaining[included] > 0L)) return("cyclic source relationships")
  # Unrelated design variables need not occur in the coding metadata.
  as.character(design_ids) %in% ids[included]
}
