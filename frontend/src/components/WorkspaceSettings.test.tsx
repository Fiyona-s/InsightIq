import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import WorkspaceSettings from './WorkspaceSettings';
import {bookmarkedPage} from '../lib/navigation';
it('settings reuses browser preferences without requesting server configuration',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch');render(<WorkspaceSettings/>);
 expect(screen.getByRole('checkbox',{name:/Show technical details/})).toBeVisible();
 expect(screen.queryByRole('checkbox',{name:/Hide sample datasets|Compact navigation/})).not.toBeInTheDocument();        // both moved: samples are hidden from Datasets, the sidebar collapses with its own button
 expect(fetch).not.toHaveBeenCalled();
});
it('preserves previous friendly links and accepts the new task labels',()=>{
 for(const [slug,key]of [['ask-your-data','AI Analyst'],['ask-insightiq','AI Analyst'],['check-answer-accuracy','Evaluation center'],['evaluation-center','Evaluation center'],['performance-&-errors','Run analytics'],['run-analytics','Run analytics'],['datasets','Data workspace'],['my-data','Data workspace'],['home','Overview'],['build-models','AutoML Studio'],['settings','Settings']]){
  window.history.replaceState(null,'','#'+slug);expect(bookmarkedPage()).toBe(key);
 }
 window.history.replaceState(null,'','/');
});
