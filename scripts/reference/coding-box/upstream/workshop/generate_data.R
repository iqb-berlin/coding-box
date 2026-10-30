# Synthetische Mini-Studie. Aus dem Projektordner starten.
library(eatPrepTBA)
library(dplyr)
library(tidyr)
library(purrr)
library(tibble)
dir.create('Daten', showWarnings = FALSE)
json <- function(x) as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = 'null'))

code <- function(id, score, type, label, match = NULL, numeric = FALSE) {
  list(id = as.integer(id), type = type, label = label, score = score,
       manualInstruction = label, ruleSetOperatorAnd = FALSE,
       ruleSets = if (is.null(match)) list() else list(list(ruleOperatorAnd = TRUE,
         rules = list(list(method = if (numeric) 'NUMERIC_MATCH' else 'MATCH',
                           parameters = list(as.character(match)))))))
}
variable <- function(id, label, manual = FALSE, derived = FALSE) {
  codes <- if (derived) list(
    code(2, 1, 'FULL_CREDIT', 'Beide Teilantworten richtig', 2, TRUE),
    code(1, 0.5, 'PARTIAL_CREDIT', 'Eine Teilantwort richtig', 1, TRUE),
    code(0, 0, 'RESIDUAL_AUTO', 'Keine Teilantwort richtig')) else if (manual) list(
    code(2, 1, 'FULL_CREDIT', 'Begruendung nennt den Textbeleg'),
    code(1, 0.5, 'PARTIAL_CREDIT', 'Passende Aussage ohne Textbeleg'),
    code(0, 0, 'NO_CREDIT', 'Unzutreffende Begruendung')) else list(
    code(1, 1, 'FULL_CREDIT', 'Richtige Auswahl A', 'A'),
    code(0, 0, 'RESIDUAL_AUTO', 'Andere Auswahl'))
  list(id = id, alias = id, label = label, sourceType = if(derived) 'SUM_SCORE' else 'BASE',
       sourceParameters = list(solverExpression = '', processing = list()),
       deriveSources = if(derived) list('Q1', 'Q2') else list(),
       processing = list(), fragmenting = '', manualInstruction = label,
       codeModel = 'NONE', page = '1', codes = codes)
}
specs <- list(
  U1 = list(variable('Q1','Information finden'), variable('Q2','Aussage erkennen')),
  U2 = list(variable('Q1','Ueberschrift auswaehlen')),
  U3 = list(variable('Q1','Erster Textbeleg'), variable('Q2','Zweiter Textbeleg'),
            variable('TOTAL','Textbelege zusammenfuehren', derived=TRUE)),
  U4 = list(variable('TEXT','Begruendung', manual=TRUE)),
  U5 = list(variable('Q1','Information vergleichen'),variable('Q2','Schluss ziehen')),
  U6 = list(variable('Q1','Alternative Schlussfolgerung')))
labels <- c('Bibliothek','Aushang','Zwei Textbelege','Begruendung','Busfahrplan','Museum')
units <- imap_dfr(specs, function(vs, key) {
  ids <- map_chr(vs,'id'); bases <- ids[ids != 'TOTAL']
  itemvars <- if(key=='U3') 'TOTAL' else ids
  tibble(ws_id=1L, ws_label='Synthetische Lesestudie', unit_id=match(key,names(specs)),
    unit_key=key, unit_label=labels[match(key,names(specs))],
    coding_scheme=json(list(variableCodings=vs,version='3.0')),
    unit_variables=list(tibble(variable_id=bases, variable_ref=bases,
      variable_type=if(key=='U4') 'string' else 'choice', variable_format='',
      variable_multiple=FALSE, variable_page=1L,
      variable_values=map(bases, ~if(key=='U4') tibble(value=NA_character_,value_label=NA_character_)
        else tibble(value=c('A','B','C'),value_label=c('Richtig','Distraktor B','Distraktor C'))))),
    variable_pages=list(tibble(variable_ref=bases,variable_page=1L,variable_section=1L,
      variable_page_always_visible=FALSE,variable_content='Synthetische Aufgabe',
      variable_element='response',value_default=NA_character_)),
    items_list=list(tibble(item_no=seq_along(itemvars),variable_id=itemvars,
                          variable_ref=itemvars,item_id=sprintf('%02d', seq_along(itemvars)))))
})
units <- add_coding_scheme(units)
saveRDS(units,'Daten/units.rds')

persons <- tibble(group_id='WS',login_name=sprintf('P%03d',1:40),
                  login_code=sprintf('SYN%03d',1:40),
                  booklet_id=rep(c('B1','B2'),each=20),person_no=1:40)
booklets <- tibble(booklet_id=rep(c('B1','B2'),each=5),booklet_no=1L,testlet_no=1L,
                  unit_booklet_no=rep(1:5,2),
                  unit_key=c('U1','U2','U3','U4','U5','U1','U2','U3','U4','U6'))
design <- left_join(persons,booklets,by='booklet_id',relationship='many-to-many') |>
  mutate(unit_alias=unit_key) |>
  left_join(imap_dfr(specs,~tibble(unit_key=.y,variable_id=map_chr(.x,'id'))),
            by='unit_key',relationship='many-to-many') |> select(-person_no)
saveRDS(design,'Daten/design.rds')
readr::write_csv(persons,'Daten/persons.csv')
readr::write_csv(booklets,'Daten/booklets.csv')

# Freitextantworten: passende Aussage, Aussage mit Textbeleg, unzutreffende Antwort.
manual_values <- rep(c(
  'Die Bibliothek ist am Samstag offen.',
  'Ja, laut Aushang: Samstag 10 bis 14 Uhr.',
  'Nein, am Wochenende ist immer geschlossen.',
  'Samstags kann man in die Bibliothek gehen.',
  'Im Aushang steht: samstags von 10 bis 14 Uhr.',
  'Weil ich das vermute.'), length.out = nrow(persons))
manual_values[5] <- ''

set.seed(20260923)
unitrows <- left_join(persons,booklets,by='booklet_id',relationship='many-to-many') |>
  filter(person_no!=40, !(person_no==2 & unit_key=='U2'), !(person_no==3 & unit_key=='U5'))
raw <- pmap_dfr(unitrows,function(group_id,login_name,login_code,booklet_id,person_no,
                                booklet_no,testlet_no,unit_booklet_no,unit_key) {
  ids <- map_chr(specs[[unit_key]],'id'); ids <- setdiff(ids,'TOTAL')
  responses <- map(ids,function(id) {
    value <- if(unit_key=='U4') manual_values[person_no] else
      sample(c('A','B','C'),1,prob=c(0.2+0.6*person_no/40,0.4-0.3*person_no/40,0.4-0.3*person_no/40))
    status <- 'VALUE_CHANGED'
    if(person_no==4 && unit_key=='U1' && id=='Q1') {value<-NULL;status<-'INVALID'}
    if(person_no==6 && unit_key=='U5') {value<-NULL;status<-'DISPLAYED'}
    list(id=id,value=value,status=status)
  })
  tibble(groupname=group_id,loginname=login_name,code=login_code,bookletname=booklet_id,
         unitname=unit_key,originalUnitId=unit_key,
         responses=json(list(list(id='elementCodes',content=json(responses),ts=1000),
                             list(id='stateVariableCodes',content='[]',ts=1000))),
         laststate=json(list(list(PLAYER='RUNNING',RESPONSE_PROGRESS='some',
                                 PRESENTATION_PROGRESS='complete'))))
})
readr::write_delim(raw,'Daten/Responses.csv',delim=';',quote='needed')
codes_manual <- persons |> filter(person_no!=40) |>
  transmute(group_id,login_name,login_code,booklet_id,unit_key='U4',variable_id='TEXT',
            value=manual_values[person_no],
            code_id=as.integer(if_else(person_no==5,-99L,(person_no %% 3L))))
readr::write_csv(codes_manual,'Daten/codes_manual.csv')

codebook <- units |> select(unit_key,coding_scheme) |>
  mutate(table=map(coding_scheme,prepare_coding_scheme)) |>
  select(-coding_scheme) |> unnest(table) |>
  select(unit_key,variable_id,variable_source_type,code_id,code_label,code_score) |> distinct()
readr::write_csv(codebook,'Daten/codebook.csv')

# Zwei kuenstliche Sessions; Zeitstempel sind Unix-Millisekunden.
events <- c('LOADCOMPLETE : {"browserName":"Firefox","osName":"Windows","device":"Desktop","screenSizeWidth":1920,"screenSizeHeight":1080,"loadTime":350}',
            'PLAYER = LOADING','PLAYER = RUNNING','PAGE_COUNT = 1','CURRENT_PAGE_NR = 1',
            'FOCUS : "HAS_NOT"','FOCUS : "HAS"',
            'RESPONSE_PROGRESS = complete','PRESENTATION_PROGRESS = complete',
            'PLAYER = LOADING','CONNECTION : "LOST"','FOCUS : "HAS_NOT"',
            'PAGE_COUNT = 1','CURRENT_PAGE_NR = 2','Runtime Error : Player crashed')
logs <- tibble(groupname='WS',loginname=c(rep('P001',9),rep('P002',6)),
               code=c(rep('SYN001',9),rep('SYN002',6)),bookletname='B1',unitname='U1',
               timestamp=1780000000000+c(0,100,450,500,550,4000,6500,12000,12100,
                                         0,100,200,300,400,500),
               logentry=events)
readr::write_delim(logs,'Daten/Logs.csv',delim=';')
cat('Data created:',nrow(units),'units;',nrow(design),'design rows;',nrow(raw),'response rows\n')
