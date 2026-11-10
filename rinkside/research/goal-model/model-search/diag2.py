from lib import *
ne = load()



print(ne[ne.type=='unknown'].groupby('season').goal.agg(['size','sum']))
t=2024; m=(ne.season==t).values
a=recal(ne,get('v2',t)); b=recal(ne,get('m730',t)); x=ne[m].copy(); x['d']=(ll(x.goal.values,a[m])-ll(x.goal.values,b[m]))*1e4
x['mo']=pd.to_datetime(x.date).dt.strftime('%Y-%m'); x['a']=a[m]; x['b']=b[m]
for by in ['mo','type','rush','rebound','period']:
    print(x.groupby(by,observed=True).agg(n=('d','size'),gain_sum=('d','sum'),goals=('goal','sum'),v2=('a','sum'),m=('b','sum')).round(1))
x['tb']=pd.cut(x.tm_shift_min,[-1,0,1,2,3,5,10,1e9]); x['ob']=pd.cut(x.op_shift_min,[-1,0,1,2,3,5,10,1e9])
for by in ['tb','ob']:
    print(x.groupby(['mo',by],observed=True).agg(n=('d','size'),gain_sum=('d','sum'),goals=('goal','sum'),v2=('a','sum'),m=('b','sum')).round(1).to_string())
