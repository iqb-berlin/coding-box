# Enhanced input validation helpers using checkmate
# These functions extend checkmate functionality with custom assertions

assert_cols <- function(x, cols, arg) {
  checkmate::assert_data_frame(x, min.rows = 0)
  checkmate::assert_character(cols, min.len = 1)
  checkmate::assert_string(arg) # name of the data frame

  missing_cols <- setdiff(cols, names(x))

  if (length(missing_cols) > 0L) {
    stop(
      paste0(
        "'", arg, "' must contain the columns {",
        paste0(cols, collapse = ", "),
        "}, but is missing the column(s): {",
        paste0(missing_cols, collapse = ", "),
        "}."
      ),
      call. = FALSE
    )
  }

  invisible(x)
}

assert_attrs <- function(x, attrs, arg) {
  checkmate::assert_character(attrs, min.len = 1)
  checkmate::assert_string(arg)

  missing_attrs <- setdiff(attrs, names(attributes(x)))

  if (length(missing_attrs) > 0L) {
    stop(
      paste0(
        "'", arg, "' must contain the attributes {",
        paste0(attrs, collapse = ", "),
        "}, but is missing the attribute(s): {",
        paste0(missing_attrs, collapse = ", "),
        "}."
      ),
      call. = FALSE
    )
  }

  invisible(x)
}

assert_existing_files <- function(files, arg = "files") {
  checkmate::assert_character(files, min.len = 1)
  checkmate::assert_string(arg)

  missing_files <- files[!file.exists(files)]

  if (length(missing_files) > 0L) {
    stop(
      paste0(
        "'", arg, "' must point to existing files, but the following path(s) do not exist: {",
        paste0(missing_files, collapse = ", "),
        "}."
      ),
      call. = FALSE
    )
  }

  invisible(files)
}

assert_url <- function(url, arg = "url") {
  checkmate::assert_string(url, min.chars = 1)
  checkmate::assert_string(arg)

  if (!grepl("^https?://", url)) {
    stop(
      paste0(
        "'", arg, "' must be a valid URL starting with http:// or https://, ",
        "but got: ", url, "."
      ),
      call. = FALSE
    )
  }

  invisible(url)
}
