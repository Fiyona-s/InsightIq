import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import KnowledgeReview from './KnowledgeReview';
import {reviewApi,type Review} from '../knowledgeReviewApi';
vi.mock('../knowledgeReviewApi',()=>({reviewApi:{get:vi.fn(),draft:vi.fn(),review:vi.fn(),all:vi.fn(),check:vi.fn(),approve:vi.fn(),remove:vi.fn(),reverify:vi.fn(),clearRejected:vi.fn()}}));
const record:Review={revision:'r1',drafts:[{id:'d',item_type:'description',item_key:'dataset',content:{description:'Proposed description'},current:{description:'Human text'},status:'draft',revision:'r1',stale:false,check:{passed:true,message:'Review required'},reviewed_at:null,provenance:{source:'ai_draft',model:'fixture',prompt_version:'v1'}}],examples:[]};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(reviewApi.get).mockResolvedValue(structuredClone(record));});
it('requests a draft only after explicit sharing confirmation and supports keyboard',async()=>{
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await screen.findByRole('heading',{name:'Review drafts'});
 expect(reviewApi.draft).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Draft with AI'}));
 expect(screen.getByRole('dialog',{name:'Draft data sharing'})).toHaveTextContent('No sample values, quality examples or row data');
 screen.getByRole('button',{name:'Confirm and draft'}).focus();await userEvent.keyboard('{Enter}');
 await waitFor(()=>expect(reviewApi.draft).toHaveBeenCalledWith('x'));
});
it('requires an explicit Replace choice for human text and keeps side-by-side values',async()=>{
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await screen.findByText('Human text');expect(screen.getByText('Proposed description')).toBeVisible();
 expect(screen.getByRole('button',{name:'Approve'})).toBeDisabled();
 await userEvent.click(screen.getByLabelText('Replace current value'));await userEvent.click(screen.getByRole('button',{name:'Approve'}));
 await waitFor(()=>expect(reviewApi.review).toHaveBeenCalledWith('x','d',{action:'approve',replace_existing:true,confirm_revision:'r1'}));
});
it('edits and checks a failed metric before approval and can reject',async()=>{
 const data=structuredClone(record);data.drafts[0]={...data.drafts[0],item_type:'metric',item_key:'Total',content:{name:'Total',description:'Definition',sql:'SELECT wrong FROM data'},current:{},check:{passed:false,message:'Could not be checked'}};
 vi.mocked(reviewApi.get).mockResolvedValue(data);
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);await screen.findByText('Could not be checked');
 expect(screen.getByRole('button',{name:'Approve'})).toBeDisabled();await userEvent.click(screen.getByRole('button',{name:'Edit'}));
 const input=screen.getByLabelText('Edit Total sql');await userEvent.clear(input);await userEvent.type(input,'SELECT COUNT(*) FROM data');await userEvent.click(screen.getByRole('button',{name:'Save and check'}));
 await waitFor(()=>expect(reviewApi.review).toHaveBeenCalledWith('x','d',expect.objectContaining({action:'edit',content:expect.objectContaining({sql:'SELECT COUNT(*) FROM data'})})));
 await userEvent.click(screen.getByRole('button',{name:'Reject'}));await waitFor(()=>expect(reviewApi.review).toHaveBeenLastCalledWith('x','d',{action:'reject'}));
});
it('confirms the eligible approve-all count',async()=>{
 const data=structuredClone(record);data.drafts[0].current={};vi.mocked(reviewApi.get).mockResolvedValue(data);
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Approve all descriptions (1)'}));
 await userEvent.click(screen.getByRole('button',{name:'Confirm 1 approvals'}));await waitFor(()=>expect(reviewApi.all).toHaveBeenCalledWith('x',['d'],'r1'));
});
it('never offers metric calculations in approve-all: each metric keeps its own Approve and shows its SQL',async()=>{
 const data=structuredClone(record);data.drafts[0].current={};
 data.drafts.push({...data.drafts[0],id:'m',item_type:'metric',item_key:'Total revenue',content:{name:'Total revenue',description:'Sum',sql:'SELECT SUM(revenue) FROM data'},current:{}} as never);
 vi.mocked(reviewApi.get).mockResolvedValue(data);
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Approve all descriptions (1)'}));
 expect(screen.getByText(/Metric calculations are not included/)).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Confirm 1 approvals'}));
 await waitFor(()=>expect(reviewApi.all).toHaveBeenCalledWith('x',['d'],'r1'));        // the metric id is never sent
 const metric=screen.getByRole('heading',{name:/Total revenue/}).closest('article')!;
 expect(within(metric).getByText(/SELECT SUM\(revenue\) FROM data/)).toBeVisible();
 expect(within(metric).getByText(/approve it on its own/)).toBeVisible();
 await userEvent.click(within(metric).getByRole('button',{name:/^Approve$/}));
 await waitFor(()=>expect(reviewApi.review).toHaveBeenCalledWith('x','m',expect.objectContaining({action:'approve'})));
});
it('with only metric drafts there is no approve-all button',async()=>{
 const data=structuredClone(record);data.drafts[0]={...data.drafts[0],item_type:'metric',current:{}} as never;vi.mocked(reviewApi.get).mockResolvedValue(data);
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);await screen.findByRole('heading',{name:/dataset|Dataset/});
 expect(screen.queryByRole('button',{name:/Approve all/})).not.toBeInTheDocument();
});
it('shows archived knowledge read-only without a draft action',async()=>{
 render(<KnowledgeReview id="x" archived onChanged={vi.fn()}/>);await screen.findByText('Human text');
 expect(screen.getByText(/Archived dataset/)).toBeVisible();expect(screen.queryByRole('button',{name:'Draft with AI'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Approve'})).toBeDisabled();
});
it('shows loading, empty and provider errors',async()=>{
 vi.mocked(reviewApi.get).mockResolvedValue({revision:'r',drafts:[],examples:[]});vi.mocked(reviewApi.draft).mockRejectedValue(new Error('Provider unavailable'));
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);expect(screen.getByRole('status')).toHaveTextContent('Loading');await screen.findByText('No drafts yet.');
 await userEvent.click(screen.getByRole('button',{name:'Draft with AI'}));await userEvent.click(screen.getByRole('button',{name:'Confirm and draft'}));expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable');
});
it('requires an independent reference and confirmation before deleting an example',async()=>{
 vi.mocked(reviewApi.get).mockResolvedValue({revision:'r',drafts:[],examples:[{id:'e',question:'How much?',sql:'SELECT 1',status:'candidate',reference_type:null,revision:'r',approved_at:null}]});
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);await screen.findByText('Candidate');
 expect(screen.getByRole('button',{name:'Approve example'})).toBeDisabled();expect(screen.getByRole('button',{name:'Check reference'})).toBeDisabled();
 await userEvent.selectOptions(screen.getByLabelText('Reference type'),'expected');await userEvent.type(screen.getByLabelText('Expected result JSON'),'2');await userEvent.click(screen.getByLabelText(/I wrote this reference independently/));await userEvent.click(screen.getByRole('button',{name:'Check reference'}));
 await waitFor(()=>expect(reviewApi.check).toHaveBeenCalledWith('x','e',expect.objectContaining({independently_authored:true,expected:2})));
 await userEvent.click(screen.getByRole('button',{name:'Delete example'}));expect(reviewApi.remove).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Confirm delete example'}));await waitFor(()=>expect(reviewApi.remove).toHaveBeenCalledWith('x','e'));
});

it('asks before clearing rejected drafts, keeps its wording and only then clears',async()=>{
 const data=structuredClone(record);data.drafts[0].status='rejected';vi.mocked(reviewApi.get).mockResolvedValue(data);
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Clear rejected drafts (1)'}));
 const dialog=screen.getByRole('dialog',{name:'Clear rejected drafts'});
 expect(dialog).toHaveTextContent('Clear 1 rejected drafts? Approved provenance is kept.');expect(reviewApi.clearRejected).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Confirm clear rejected drafts'}));await waitFor(()=>expect(reviewApi.clearRejected).toHaveBeenCalledWith('x',1));
});
it('lists exactly what is shared before drafting and keeps Cancel free of side effects',async()=>{
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Draft with AI'}));
 const dialog=screen.getByRole('dialog',{name:'Draft data sharing'});
 expect(dialog).toHaveTextContent('only the dataset name, column names, inferred types, row counts, null counts and unique counts. No sample values, quality examples or row data.');
 await userEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(reviewApi.draft).not.toHaveBeenCalled();
});
it('the verification starts on "your own answer", shows three steps, and never pre-ticks or combines the safeguards',async()=>{
 vi.mocked(reviewApi.get).mockResolvedValue({revision:'r',drafts:[],examples:[{id:'e',question:'How much?',sql:'SELECT 1',status:'candidate',reference_type:null,revision:'r',approved_at:null}]});
 render(<KnowledgeReview id="x" archived={false} onChanged={vi.fn()}/>);await screen.findByText('Candidate');
 expect(screen.getByLabelText('Reference type')).toHaveValue('scalar');
 expect(within(screen.getByRole('list',{name:'Steps to verify this example'})).getAllByRole('listitem').map(i=>i.textContent)).toEqual(['Write the answer yourself','Check it against the example','Approve it']);
 const independent=screen.getByLabelText(/I wrote this reference independently/);expect(independent).not.toBeChecked();
 const check=screen.getByRole('button',{name:'Check reference'}),approve=screen.getByRole('button',{name:'Approve example'});
 expect(check).toBeDisabled();expect(approve).toBeDisabled();                                    // two separate buttons, both off until the owner acts
 await userEvent.type(screen.getByLabelText('Single value'),'42');expect(check).toBeDisabled();  // value typed but not yet confirmed as independent
 await userEvent.click(independent);expect(check).toBeEnabled();expect(approve).toBeDisabled();  // checking never approves
 await userEvent.click(check);await waitFor(()=>expect(reviewApi.check).toHaveBeenCalledWith('x','e',expect.objectContaining({independently_authored:true})));
 expect(reviewApi.approve).not.toHaveBeenCalled();
});
