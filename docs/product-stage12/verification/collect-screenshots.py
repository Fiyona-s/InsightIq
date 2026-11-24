from pathlib import Path
import shutil
out=Path('docs/product-stage12/journeys');out.mkdir(exist_ok=True)
for name,source in {'dashboard':'docs/product-stage5/after/view-1280.png','currency':'docs/phase6/after/currency-provenance.png','model':'docs/phase7/after/negative-r2.png','evaluation-failure':'docs/phase8/after/detail-diff.png','analyst-details':'docs/product-stage4/after/details.png'}.items():
 assert Path(source).exists(),source
 shutil.copy2(source,out/(name+'.png'))
print('Copied five isolated workflow screenshots')
