"""Specification oracle. Python stdlib only; never imports or runs application code.

Rules come from the pinned workshop, Missing vignette and issue contracts listed
in corpus.json. R independently checks these expectations before sealing them.
"""
import argparse
import csv
import hashlib
import json
import io
from collections import Counter
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATUS = ['UNSET', 'NOT_REACHED', 'DISPLAYED', 'VALUE_CHANGED', 'DERIVE_ERROR',
          'CODING_COMPLETE', 'NO_CODING', 'INVALID', 'CODING_INCOMPLETE',
          'CODING_ERROR', 'PARTLY_DISPLAYED', 'DERIVE_PENDING',
          'INTENDED_INCOMPLETE', 'CODE_SELECTION_PENDING']
PROFILE = {'mir': [-98, 0], 'mci': [-97, None], 'mbi_mbo': [-99, 0],
           'mnr': [-96, None], 'mbd': [-95, None]}

def read_csv(name):
    with (ROOT / 'upstream/workshop' / name).open(newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f, delimiter=';' if 'responses' in name.lower() else ','))

def payload(row):
    envelopes = json.loads(row['responses'])
    return json.loads(next(e['content'] for e in envelopes if e['id'] == 'elementCodes'))

def dump(name, value, check):
    content = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    p = ROOT / name
    if check:
        assert p.read_text() == content, f'{name} is stale: run generate.py and independent R verification'
    else:
        p.write_text(content)

def matrix_csv(study,check):
    for matrix in study['matrices']:
        for requested in ['code','score']:
            output=io.StringIO(newline='')
            writer=csv.writer(output,delimiter=';',lineterminator='\n')
            writer.writerow(['person_login','person_code','person_group','booklet_name']+[c['header'] for c in study['columns']])
            for person,row in zip(study['persons'],matrix['rows']):
                values=[cell[requested] if cell[requested] is not None else 'NA' for cell in row]
                values=[int(v) if isinstance(v,float) and v.is_integer() else v for v in values]
                writer.writerow([person['login_name'],person['login_code'],person['group_id'],person['booklet_id']]+values)
            path=ROOT/f"expected-matrix-{'recode' if matrix['recode'] else 'keep'}-{requested}.csv"
            if check: assert path.read_text()==output.getvalue(),str(path)
            else: path.write_text(output.getvalue())

def study():
    units = json.loads((ROOT/'workshop-units.json').read_text())
    manual = {(r['login_name'], r['unit_key']): int(r['code_id']) for r in read_csv('codes_manual.csv')}
    cases = []
    for r in read_csv('Responses.csv'):
        raw = payload(r)
        expected = []
        for a in raw:
            if r['unitname'] == 'U4':
                c = manual[r['loginname'], r['unitname']]
                score = {-99: 0, 0: 0, 1: .5, 2: 1}[c]
                status = 'CODING_COMPLETE' if c >= 0 else 'DISPLAYED'
            elif a['status'] in ['INVALID', 'DISPLAYED']:
                c, score, status = None, None, a['status']
            else:
                c = int(a['value'] == 'A')
                score, status = c, 'CODING_COMPLETE'
            expected.append(dict(id=a['id'], code=c, score=score, status=status))
        if r['unitname'] == 'U3':
            points = sum(a['score'] for a in expected)
            expected.append(dict(id='TOTAL', code=points, score=points/2, status='CODING_COMPLETE'))
        cases.append(dict(id=f"study-{r['loginname']}-{r['unitname']}", person=r['loginname'],
                          manualCode=manual.get((r['loginname'],r['unitname'])),
                          booklet=r['bookletname'], unit=r['unitname'], input=raw, expected=expected))
    demos = []
    for i, r in enumerate(read_csv('demo-pc-responses.csv')):
        demos.append(dict(id=f'demo-D{i+1}', unit=r['unitname'], input=payload(r),
                          expected={'id': '01', 'code': [1,2,0,0][i], 'score': [2,1,0,0][i], 'status':'CODING_COMPLETE'}))
    persons=read_csv('persons.csv')
    booklets=read_csv('booklets.csv')
    columns=[dict(unit=u['key'],variable=i['variable_id'],header=u['key']+'_'+i['item_id']) for u in units['units'] for i in u['items']]
    matrices=[]
    lookup={(c['person'],c['unit'],r['id']):r for c in cases for r in c['expected']}
    for recode in [False,True]:
        matrix=[]
        for person in persons:
            design=[b['unit_key'] for b in booklets if b['booklet_id']==person['booklet_id']]
            ordered=[c for c in columns if c['unit'] in design]
            values=[]
            for c in columns:
                r=lookup.get((person['login_name'],c['unit'],c['variable']))
                if c['unit'] not in design:code,score=PROFILE['mbd']
                elif r and r['code'] is not None:code,score=r['code'],r['score']
                elif r and r['status']=='INVALID':code,score=PROFILE['mir']
                elif r and r['status']=='DISPLAYED' and not recode:code,score=PROFILE['mbi_mbo']
                else:
                    later=ordered[ordered.index(c)+1:]
                    activity=any((q:=lookup.get((person['login_name'],x['unit'],x['variable']))) is not None and
                                 (q['code'] is not None or q['status'] not in (['DISPLAYED','NOT_REACHED'] if recode else ['NOT_REACHED'])) for x in later)
                    code,score=PROFILE['mbi_mbo' if activity else 'mnr']
                values.append(dict(code=code,score=score))
            matrix.append(values)
        matrices.append(dict(recode=recode,rows=matrix))
    return dict(units=units['units'], demoUnits=units['demoUnits'], cases=cases, demos=demos,
                persons=persons,booklets=booklets,columns=columns,matrices=matrices)

def missing():
    # R supplies the layout order, independently of Kodierbox's own metadata parser.
    # Profile-neutral v1 inputs retain positive results; missing codes are applied
    # only at the export boundary (REQ-741), unlike upstream's prepared R table.
    cases=[]
    for case in json.loads((ROOT/'missing-oracle.json').read_text()):
        source=case['input']
        positions={(r['unit_key'],r['variable_id']):r['variable_position'] for r in case['modes'][0]['rows']}
        for recode in [False,True]:
            rows=[]
            for r in source:
                rows.append(dict(unit=r['unit_key'], variable=r['variable_id'], testlet=r['testlet_no'],
                                 position=positions[r['unit_key'],r['variable_id']], present=r['response_present'],
                                 status=r['code_status'], code=r['code_id'] if (r['code_id'] or 0)>=0 else None,
                                 score=r['code_score'] if (r['code_id'] is not None and r['code_id']>=0) else None))
            expected=[]
            profile=dict(PROFILE)
            if case['id']==11:
                profile.update(mnr=[-196,.5],mbi_mbo=[-199,0])
            for r in rows:
                if r['code'] is not None:
                    expected.append(dict(state='valid',code=r['code'],score=r['score']));continue
                s=r['status']
                state={'INVALID':'mir','CODING_ERROR':'mci'}.get(s)
                if s=='NO_CODING':
                    expected.append(dict(state='error',reason='unresolved-status'));continue
                if state is None:
                    later=[x for x in rows if x['testlet']==r['testlet'] and
                           (int(x['unit'][1:]),x['position'])>(int(r['unit'][1:]),r['position'])]
                    neutral=['NOT_REACHED','NO_CODING',None]+(['DISPLAYED','PARTLY_DISPLAYED','UNSET'] if recode else [])
                    activity=any(x['present'] and (x['code'] is not None or x['status'] not in neutral) for x in later)
                    omission=s in ['DISPLAYED','PARTLY_DISPLAYED','UNSET']
                    state='mbi_mbo' if (omission and not recode) or activity else 'mnr'
                c,score=profile[state]
                expected.append(dict(state=state,code=c,score=score))
            cases.append(dict(id=f"missing-{case['id']:02d}-{'recode' if recode else 'keep'}", sourceCase=case['id'],
                              issues=[1116,741], recode=recode, profile=profile, metadata=case['units'], rows=rows,expected=expected))
    return cases

def kappa(left,right):
    pairs=[(a,b) for a,b in zip(left,right) if a is not None and b is not None]
    n=len(pairs)
    if not n:return dict(kappa=None,agreement=0,validPairs=0)
    a,b=Counter(x for x,y in pairs),Counter(y for x,y in pairs)
    po=Fraction(sum(x==y for x,y in pairs),n)
    pe=sum((Fraction(a[v]*b[v],n*n) for v in a.keys()|b.keys()),Fraction())
    return dict(kappa=float(1 if po==1 else (po-pe)/(1-pe)),agreement=float(po),validPairs=n)

def edges():
    stats=[]
    for name,a,b in [('code-versus-score',[0,0,6,8,9,0,6,8,None],[0,6,6,9,9,0,0,8,0]),
                     ('two-scores',[1,1,1,0,0,0,1,0],[1,1,0,0,0,1,1,0]),
                     ('perfect-constant',[0]*3,[0]*3),('all-disagree',[0,1],[1,0]),
                     ('no-pairs',[None],[0]),('zero-is-valid',[0,None,1],[0,1,None])]:
        stats.append(dict(id='kappa-'+name,issues=[506,426],left=a,right=b,expected=kappa(a,b)))
    empties=[]
    for name,value,selected in [('null',None,True),('empty','',True),('whitespace',' \t ',True),
                                ('array','[]',True),('zero','0',False),('false','false',False),('text-null','null',False)]:
        empties.append(dict(id='empty-base-'+name,issues=[970,973],target='B',value=value,sources=[],derived={},selected=selected))
    for name,sources,derived,selected in [
        ('all-empty',[['A','',5],['B','[]',5]],{'D':['A','B']},True),
        ('answered-source',[['A','answer',5],['B','',5]],{'D':['A','B']},False),
        ('nested',[['A','answer',5]],{'D':['I'],'I':['A']},False),
        ('missing-source',[],{'D':['A']},False),
        ('duplicate-source',[['A','',5],['A','',5]],{'D':['A']},False),
        ('cycle',[],{'D':['I'],'I':['D']},False),
        ('mc-reason-empty',[['A','selected',5],['B','',12]],{'D':['A','B']},True),
        ('mc-reason-answered',[['A','selected',5],['B','reason',12]],{'D':['A','B']},False),
        ('mc-ambiguous',[['A','selected',7],['B','',12]],{'D':['A','B']},False)]:
        empties.append(dict(id='empty-derived-'+name,issues=[970,972,973],target='D',value='technical',sources=sources,
                            derived=derived,selected=selected))
    version=[]
    # Manually specified contracts; v2 is never re-profiled from a raw status.
    for name,s,c,score,expected in [
        ('zero',5,0,0,[0,0]),('invalid',7,None,None,[-98,0]),('coding-error',9,None,None,[-97,'NA']),
        ('not-reached',1,None,None,[-96,'NA']),('omitted',2,None,None,[-99,0]),
        ('partly',10,None,None,[-99,0]),('unset',0,None,None,[-99,0]),
        ('manual-mir',5,-3,None,[-98,0]),('manual-mci',5,-4,None,[-97,'NA']),
        ('pending',11,None,None,['','']),('score-only',5,None,0,['',0])]:
        version.append(dict(id='version-'+name,issues=[741,341,777],status=s,code=c,score=score,expected=expected))
    # Partial inputs remain export errors rather than invented zeroes/NA.
    errors=[dict(id='export-code-without-score',status=5,code=1,score=None,requested='score',reason='missing-score'),
            dict(id='export-score-without-code',status=5,code=None,score=0,requested='code',reason='missing-code'),
            dict(id='export-pending',status=11,code=None,score=None,requested='code',reason='unresolved-status')]
    precedence=['mbi_mbo','mnr','mir','valid','mci']
    aggregate=[]
    for left in precedence+['mbd','error']:
        for right in precedence+['mbd','error']:
            expected='error' if 'error' in [left,right] or ('mbd' in [left,right] and left!=right) else ('mbd' if left==right=='mbd' else max([left,right],key=precedence.index))
            aggregate.append(dict(id=f'aggregate-{left}-{right}',issues=[741],states=[left,right],expected=expected))
    persistence=[dict(id='duplicate-existing-id',issues=[1012,434],targets=[dict(id=10),dict(id=10)],duplicate=True),
                 dict(id='duplicate-generated-target',issues=[1012],targets=[dict(id=-1,isNew=True,unitid=1,variableid='D',subform='S')]*2,duplicate=True),
                 dict(id='distinct-subforms',issues=[1012],targets=[dict(id=-1,isNew=True,unitid=1,variableid='D',subform=s) for s in ['S1','S2']],duplicate=False)]
    partial=[]
    for source_type,value in [('SUM_SCORE',3),('SUM_CODE',2),('CONCAT_CODE','2_x')]:
        for option,status in [('TAKE_DISPLAYED_AS_ZERO_IF_PARTIAL','DISPLAYED'),('TAKE_EMPTY_AS_ZERO_IF_PARTIAL','INVALID')]:
            for enabled in [False,True]:
                partial.append(dict(id=f'partial-{source_type}-{status}-{enabled}',issues=[973,1043],sourceType=source_type,option=option,
                                    status=status,enabled=enabled,expectedValue=value if enabled else None,expectedStatus='NO_CODING' if enabled else 'INVALID'))
    derived=[dict(id='derived-result-missing',issues=[1014],sources=['A'],values=[['A',5,1,1]],reason='derived-result-missing'),
             dict(id='derived-source-unresolved',issues=[1014],sources=['A'],values=[['A',11,None,None]],reason='derived-source-unresolved'),
             dict(id='derived-cycle',issues=[1014],sources=['D'],values=[],reason='derived-cycle')]
    primitives=[dict(id='primitive-'+name,issues=[1043,433],value=value,code=code,score=score) for name,value,code,score in
                [('null',None,7,2),('empty','',0,0),('text-null','null',8,3),('empty-array',[],0,0),('zero',0,0,0),('false',False,0,0)]]
    scopes=[dict(id=f'scope-{scope}-{same}',scope=scope,sameTestlet=same,expected=-99 if scope=='booklet' or (scope=='testlet' and same) else -96)
            for scope in ['unit','testlet','booklet'] for same in [False,True]]
    return dict(profile=PROFILE,kappa=stats,empty=empties,version=version,errors=errors,derived=derived,primitives=primitives,
                aggregate=aggregate,persistence=persistence,partial=partial,scopes=scopes,
                fleiss=dict(issues=[426],ratings=[[0,0,0],[0,0,1],[0,1,1],[1,1,1],[1,2,2],[2,2,2]],
                            expected=float(Fraction(53,107))))

if __name__=='__main__':
    check=argparse.ArgumentParser();check.add_argument('--check',action='store_true');args=check.parse_args()
    study_data=study()
    dump('study.json',study_data,args.check)
    matrix_csv(study_data,args.check)
    dump('missing-cases.json',missing(),args.check)
    dump('edge-cases.json',edges(),args.check)
    print('Reference expectations: Python specification oracle agrees with checked-in fixtures.' if args.check else 'Reference fixtures generated; independent R verification is required.')
