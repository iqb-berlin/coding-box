# Second oracle: independent R arithmetic and upstream R completion.
# No JavaScript, Kodierbox or IQB Autocoder is called here.
suppressPackageStartupMessages(library(jsonlite))
p <- 'scripts/reference/coding-box'
read <- function(f) fromJSON(file.path(p,f),simplifyVector=FALSE)
equal <- function(a,b) isTRUE(all.equal(a,b,check.attributes=FALSE))
assert <- function(ok,id) if (!isTRUE(ok)) stop(id, call.=FALSE)
study <- read('study.json')
manual <- read.csv(file.path(p,'upstream/workshop/codes_manual.csv'))
for (case in study$cases) {
  scores <- numeric()
  for (i in seq_along(case$input)) {
    a <- case$input[[i]]; e <- case$expected[[i]]
    if (case$unit=='U4') {
      c <- manual$code_id[manual$login_name==case$person]
      score <- if(c==-99) 0 else c/2
      status <- if(c==-99) 'DISPLAYED' else 'CODING_COMPLETE'
    } else if(a$status %in% c('DISPLAYED','INVALID')) {
      c <- NULL; score <- NULL; status <- a$status
    } else {
      c <- as.integer(a$value=='A');score <- c;status <- 'CODING_COMPLETE'
    }
    assert(equal(e$code,c) && equal(e$score,score) && equal(e$status,status),case$id)
    scores <- c(scores, score)
  }
  if(case$unit=='U3') {
    e <- case$expected[[3]]
    assert(equal(e$code,sum(scores)) && equal(e$score,mean(scores)),case$id)
  }
}
assert(length(study$cases)==193,'193 stored person-unit inputs')
for(case in study$demos) {
  answers <- vapply(case$input, function(x) x$value, character(1))
  correct <- sum(answers==c('21','112','1102'))
  score <- c(0,0,1,2)[correct+1]
  code <- c(0,0,2,1)[correct+1]
  assert(equal(case$expected$score,score) && equal(case$expected$code,code),case$id)
}
# Check the Python Missing oracle against the actual, pinned R implementation.
# NO_CODING deliberately has no export mapping in Kodierbox (REQ-741).
upstream <- read('missing-oracle.json')
missing <- read('missing-cases.json')
for(case in missing) {
  if(case$sourceCase==10) {
    assert(case$expected[[1]]$reason=='unresolved-status',case$id)
    next
  }
  ref <- upstream[[case$sourceCase]]$modes[[if(case$recode) 2 else 1]]$rows
  for(i in seq_along(case$rows)) {
    r <- case$rows[[i]]
    at <- which(vapply(ref,function(x) x$unit_key==r$unit && x$variable_id==r$variable, logical(1)))
    e <- case$expected[[i]]; actual <- ref[[at]]
    assert(equal(e$code,actual$code_id) && equal(e$score,actual$code_score),paste(case$id,r$unit,r$variable))
  }
}
edge <- read('edge-cases.json')
for(case in edge$kappa) {
  a <- vapply(case$left,function(x) if(is.null(x)) NA_real_ else x,numeric(1))
  b <- vapply(case$right,function(x) if(is.null(x)) NA_real_ else x,numeric(1))
  keep <- complete.cases(a,b);a<-a[keep];b<-b[keep];n<-length(a)
  assert(n==case$expected$validPairs,case$id)
  if(!n) {assert(is.null(case$expected$kappa),case$id);next}
  tab <- table(factor(a,levels=sort(unique(c(a,b)))),factor(b,levels=sort(unique(c(a,b)))))
  po <- sum(diag(tab))/n
  pe <- sum(rowSums(tab)*colSums(tab))/n^2
  k <- if(po==1) 1 else (po-pe)/(1-pe)
  assert(equal(k,case$expected$kappa) && equal(po,case$expected$agreement),case$id)
}
ratings <- do.call(rbind,lapply(edge$fleiss$ratings,unlist))
categories <- sort(unique(as.vector(ratings)))
counts <- t(apply(ratings,1,function(x) tabulate(match(x,categories),length(categories))))
raters <- ncol(ratings)
po <- mean(rowSums(counts*(counts-1))/(raters*(raters-1)))
pe <- sum((colSums(counts)/sum(counts))^2)
assert(equal((po-pe)/(1-pe),edge$fleiss$expected),'Fleiss table')
# Selection expectations are independently specified by issue truth tables.
empty_cases <- edge$empty
blank <- function(x) is.null(x) || trimws(x) %in% c('','[]')
for(case in empty_cases) {
  if(length(case$derived)==0) {actual<-blank(case$value)} else {
    leaves <- function(id,path=character()) {
      if(id %in% path) return(NULL)
      children<-case$derived[[id]]
      if(is.null(children)) return(id)
      resolved<-lapply(children,function(x) leaves(x,c(path,id)))
      if(any(vapply(resolved,is.null,logical(1)))) return(NULL)
      unique(unlist(resolved))
    }
    ids <- leaves(case$target)
    source_ids<-vapply(case$sources,function(x) x[[1]],character(1))
    actual<-!is.null(ids) && all(vapply(ids,function(id) sum(source_ids==id)==1,logical(1)))
    if(actual) {
      sources<-case$sources[match(ids,source_ids)]
      statuses<-vapply(sources,function(x) x[[3]],numeric(1))
      if(12 %in% statuses) {
        actual<-setequal(statuses,c(5,12)) && all(vapply(sources[statuses==12],function(x) blank(x[[2]]),logical(1)))
      } else actual<-all(vapply(sources,function(x) blank(x[[2]]),logical(1)))
    }
  }
  assert(equal(actual,case$selected),case$id)
}
# Explicit per-status table, separate from Python fixture construction.
status_codes<-c('0'=-99,'1'=-96,'2'=-99,'7'=-98,'9'=-97,'10'=-99)
for(case in edge$version) {
  expected <- if(!is.null(case$code) && case$code==-3) list(-98,0) else
    if(!is.null(case$code) && case$code==-4) list(-97,'NA') else
    if(!is.null(case$code)||!is.null(case$score)) list(if(is.null(case$code)) '' else case$code,if(is.null(case$score)) '' else case$score) else {
      c<-status_codes[as.character(case$status)]
      if(is.na(c)) list('','') else list(unname(c),if(c %in% c(-96,-97)) 'NA' else 0)
    }
  assert(equal(expected,case$expected),case$id)
}
cat('Independent R verification passed: workshop, partial credit, 18 Missing cases x 2 modes, kappa, empty selection and version mapping.\n')
# Priority policy is checked separately from the application's pair lookup table.
rank <- c(mbi_mbo=0,mnr=1,mir=2,valid=3,mci=4)
for(case in edge$aggregate) {
  states <- unlist(case$states)
  expected <- if('error' %in% states) 'error' else if('mbd' %in% states) {
    if(all(states=='mbd')) 'mbd' else 'error'
  } else names(which.max(rank[states]))
  assert(expected==case$expected,case$id)
}
for(case in edge$persistence) {
  targets<-vapply(case$targets,function(t) {
    if(isTRUE(t$isNew)) paste(t$unitid,t$variableid,t$subform,sep='/') else paste('response',t$id)
  },character(1))
  assert((anyDuplicated(targets)>0)==case$duplicate,case$id)
}
for(case in edge$partial) {
  # A has code 2 and score 3; B has no numeric result.
  expected <- if(!case$enabled) NULL else switch(case$sourceType,SUM_CODE=2,SUM_SCORE=3,CONCAT_CODE='2_x')
  assert(equal(case$expectedValue,expected),case$id)
}
cat('Independent R verification passed: 49 Missing aggregation pairs, duplicate targets and 12 partial-source cases.\n')
for(case in edge$primitives) {
  is_null <- is.null(case$value)
  is_text_null <- is.character(case$value) && identical(case$value,'null')
  expected_code <- if(is_null) 7 else if(is_text_null) 8 else 0
  expected_score <- if(is_null) 2 else if(is_text_null) 3 else 0
  assert(equal(case$code,expected_code) && equal(case$score,expected_score),case$id)
}
# The three derived diagnostics are prescribed outcomes from #1014, not values
# obtained by running a production resolver.
assert(setequal(vapply(edge$derived,function(x) x$reason,character(1)),
                c('derived-result-missing','derived-source-unresolved','derived-cycle')),'derived diagnostics')
# Compare all 320 matrix cells in both modes to pinned R complete_design.
# The previous checks established each coded input independently from raw data.
suppressPackageStartupMessages(library(dplyr))
suppressPackageStartupMessages(library(tidyr))
suppressPackageStartupMessages(library(magrittr))
up<-file.path(p,'upstream/eatPrepTBA')
for(f in c('cli-setting.R','input_validation.R','add_coding_scheme.R','complete_design_boundary.R','complete_design.R')) source(file.path(up,f))
units<-readRDS(file.path(p,'upstream/workshop/units.rds'))
design<-readRDS(file.path(p,'upstream/workshop/design.rds'))
coded<-bind_rows(lapply(study$cases,function(case) bind_rows(lapply(seq_along(case$expected),function(i) {
 e<-case$expected[[i]]
 raw<-case$input[[min(i,length(case$input))]]
 person<-Filter(function(x) x$login_name==case$person,study$persons)[[1]]
 tibble(group_id=person$group_id,login_name=case$person,login_code=person$login_code,booklet_id=case$booklet,
        unit_key=case$unit,unit_alias=case$unit,variable_id=e$id,value=if(e$id=='TOTAL') NA_character_ else as.character(raw$value %||% NA_character_),
        code_id=e$code %||% NA_integer_, code_score=e$score %||% NA_real_,code_status=e$status,
        code_type=if(is.null(e$code)) NA_character_ else if(e$code==-99) 'MISSING_BY_OMISSION' else if(e$score==1) 'FULL_CREDIT' else 'NO_CREDIT')
}))))
for(matrix in study$matrices) {
 result<-suppressWarnings(complete_design(coded,units,design,recode_omissions_to_not_reached=matrix$recode,preserve_not_reached=FALSE))
 for(i in seq_along(study$persons)) for(j in seq_along(study$columns)) {
  person<-study$persons[[i]];column<-study$columns[[j]];e<-matrix$rows[[i]][[j]]
  r<-filter(result,login_name==person$login_name,unit_key==column$unit,variable_id==column$variable)
  code<-if(!nrow(r)) -95 else r$code_id
  score<-if(!nrow(r)||is.na(r$code_score)) NULL else r$code_score
  assert(equal(e$code,code)&&equal(e$score,score),paste('matrix',matrix$recode,i,j))
 }
}
cat('Independent R verification passed: all 640 Code/Score matrix cells (40 persons x 8 items x 2 modes).\n')
for(case in edge$scopes) {
  later_activity_relevant<-case$scope=='booklet'||(case$scope=='testlet'&&case$sameTestlet)
  assert(case$expected==if(later_activity_relevant) -99 else -96,case$id)
}
for(case in edge$errors) {
 reason<-if(is.null(case$code)&&is.null(case$score)) 'unresolved-status' else if(is.null(case$code)) 'missing-code' else 'missing-score'
 assert(reason==case$reason,case$id)
}
for(case in edge$derived) {
 reason<-if('D' %in% unlist(case$sources)) 'derived-cycle' else if(any(vapply(case$values,function(x) x[[2]]==11,logical(1)))) 'derived-source-unresolved' else 'derived-result-missing'
 assert(reason==case$reason,case$id)
}
for(case in edge$partial) assert(case$expectedStatus==if(case$enabled) 'NO_CODING' else 'INVALID',case$id)
