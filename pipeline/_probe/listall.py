from jaxa.earth import je
l = je.ImageCollectionList().filter_name([])
cols = l[0] if isinstance(l, (list,tuple)) else getattr(l,"collections",l)
cols = list(cols)
print("TOTAL:", len(cols))
import re
kw = ["temp","TEMP","Temp","AIR","air","JRA","ERA5","reanalys","climate","AT_","TA_","LST","SST","heat"]
for c in cols:
    if any(k in c for k in kw): print(" ", c)
