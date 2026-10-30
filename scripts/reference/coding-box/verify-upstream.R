# Reproduce upstream Missing examples without installing the package or calling Kodierbox.
# Sources are frozen at ec12e07a35968b70a91ea344a25acf502e7f6a79 (MIT).
library(dplyr)
library(tidyr)
library(purrr)
library(magrittr)
library(jsonlite)
base <- "scripts/reference/coding-box"
up <- file.path(base, "upstream/eatPrepTBA")
for (f in c("cli-setting.R", "input_validation.R", "add_coding_scheme.R", "complete_design_boundary.R", "complete_design.R")) source(file.path(up, f))
# The fixture builder is documentation code, copied unchanged from the pinned vignette.
vignette <- readLines(file.path(up, "missing-examples.Rmd"), encoding = "UTF-8")
start <- grep("^make_fixture <- function", vignette)
end <- start + which(vignette[(start+1):length(vignette)] == "}")[1]
eval(parse(text = vignette[start:end]))
inputs <- read.csv(file.path(up, "missing-examples.csv"), na.strings="NA", stringsAsFactors=FALSE,
  colClasses=c(value="character",code_status="character",code_type="character",
               legacy_code_status="character",legacy_code_type="character")) |> as_tibble()
out <- lapply(1:18, function(id) {
  rows <- filter(inputs, case_id == id)
  f <- make_fixture(rows)
  modes <- lapply(c(FALSE, TRUE), function(recode) {
    r <- suppressWarnings(complete_design(f$coded, f$units, f$design,
      identifiers="login_code", missings=f$missings,
      recode_omissions_to_not_reached=recode, preserve_not_reached=FALSE))
    list(recode=recode, rows=select(r, unit_key, variable_id, variable_position, code_id, code_score, code_status, code_type, id_used))
  })
  list(id=id, input=rows, units=f$units, design=f$design, modes=modes)
})
encoded <- toJSON(out, pretty=TRUE, auto_unbox=TRUE, na="null", null="null", digits=16)
if ("--check" %in% commandArgs(trailingOnly=TRUE)) {
  expected <- fromJSON(file.path(base,"missing-oracle.json"),simplifyVector=FALSE)
  stopifnot(isTRUE(all.equal(fromJSON(encoded,simplifyVector=FALSE),expected)))
} else writeLines(encoded,file.path(base,"missing-oracle.json"),useBytes=TRUE)
cat("Upstream R oracle: 18 cases, two omission modes.\n")
