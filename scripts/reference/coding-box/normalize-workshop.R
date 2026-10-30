# Normalize only the schema and item mapping from the frozen workshop RDS inputs.
# No calculations and no live Studio/Testcenter connection.
library(jsonlite)
p <- 'scripts/reference/coding-box'
u <- function(name) {
 x<-readRDS(file.path(p,'upstream/workshop',name))
 lapply(seq_len(nrow(x)),function(i) list(key=x$unit_key[i],
   scheme=fromJSON(x$coding_scheme[i],simplifyVector=FALSE)$variableCodings,
   items=x$items_list[[i]]))
}
result<-list(units=u('units.rds'),demoUnits=u('demo-pc-units.rds'))
encoded<-toJSON(result,auto_unbox=TRUE,pretty=TRUE,na='null',null='null')
if('--check' %in% commandArgs(trailingOnly=TRUE)) {
 stopifnot(isTRUE(all.equal(fromJSON(encoded,simplifyVector=FALSE),fromJSON(file.path(p,'workshop-units.json'),simplifyVector=FALSE))))
} else writeLines(encoded,file.path(p,'workshop-units.json'),useBytes=TRUE)
