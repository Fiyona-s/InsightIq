import {expect,it} from 'vitest';
import {freshnessHelp,freshnessLabel} from './freshness';
it('a chart saved before change tracking gets plain wording and a reason; other statuses are untouched',()=>{
  for (const status of ['Revision not recorded', undefined, null]) {
    expect(freshnessLabel(status)).toBe('Saved before change tracking');
    expect(freshnessHelp(status)).toMatch(/cannot tell whether the data has changed.*Refresh to start tracking/);
  }
  for (const status of ['Current', 'Source changed', 'Source unavailable']) { expect(freshnessLabel(status)).toBe(status); expect(freshnessHelp(status)).toBeUndefined(); }
});
