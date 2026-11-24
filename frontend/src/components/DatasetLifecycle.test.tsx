import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DatasetManager from './DatasetManager';
import DatasetLifecycleDialog from './DatasetLifecycleDialog';
import {lifecycleApi,type Dependencies} from '../datasetLifecycleApi';
import type {Dataset} from '../api';
vi.mock('../datasetLifecycleApi',()=>({lifecycleApi:{rename:vi.fn(),dependencies:vi.fn(),archive:vi.fn(),restore:vi.fn(),delete:vi.fn(),bulkArchive:vi.fn(),bulkDelete:vi.fn(),bulkSample:vi.fn(),setSample:vi.fn()}}));
const dataset:Dataset={id:'test-1',name:'synthetic-throwaway.csv',display_name:'Temporary sales',rows:2,bytes:24,columns:[],created_at:'2026-01-01',is_sample:true};
const archived:Dataset={...dataset,id:'test-2',name:'archived.csv',display_name:null,is_sample:false,archived_at:'2026-01-02'};
const empty:Dependencies={dataset_id:dataset.id,name:'Temporary sales',original_name:dataset.name,groups:{},counts:{},has_dependencies:false,delete_blocked:false,benchmark_required:false,benchmark_warning:null};
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();vi.mocked(lifecycleApi.dependencies).mockImplementation(async id=>({...empty,dataset_id:id}));vi.mocked(lifecycleApi.rename).mockResolvedValue(dataset);vi.mocked(lifecycleApi.bulkArchive).mockResolvedValue([{id:dataset.id,status:'success',reason:null}]);});
const manager=()=>render(<DatasetManager datasets={[dataset,archived,{...dataset,id:'test-3',name:'other.csv',display_name:'Other',is_sample:false}]} selected={dataset} query="" onSelect={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} onNavigate={vi.fn()} allowNavigation={()=>true} onHistory={vi.fn()}/>);
it('renames inline, validates, warns on duplicates, and Escape cancels',async()=>{
 const user=userEvent.setup();manager();await user.click(screen.getByLabelText('Actions for Temporary sales'));await user.click(screen.getByRole('menuitem',{name:'Rename'}));
 const input=screen.getByLabelText('Dataset display name');await user.clear(input);await user.type(input,'Other');expect(screen.getByRole('status')).toHaveTextContent('Another dataset');
 await user.clear(input);await user.type(input,'x'.repeat(121));await user.keyboard('{Enter}');expect(screen.getByRole('alert')).toHaveTextContent('120');expect(lifecycleApi.rename).not.toHaveBeenCalled();
 await user.clear(input);await user.type(input,'Renamed sales');await user.keyboard('{Enter}');await waitFor(()=>expect(lifecycleApi.rename).toHaveBeenCalledWith(dataset.id,'Renamed sales'));
});
it('Escape cancels without saving',async()=>{const user=userEvent.setup();manager();await user.dblClick(screen.getByRole('button',{name:/^Temporary sales/}));await user.clear(screen.getByLabelText('Dataset display name'));await user.type(screen.getByLabelText('Dataset display name'),'Unsaved');await user.keyboard('{Escape}');expect(screen.queryByLabelText('Dataset display name')).not.toBeInTheDocument();expect(lifecycleApi.rename).not.toHaveBeenCalled();});
it('filters archives, persists sample toggle, and selects only visible rows',async()=>{
 const user=userEvent.setup();manager();expect(screen.getByText('Sample')).toBeVisible();await user.click(screen.getByLabelText('Hide sample data'));expect(localStorage.getItem('insightiq-hide-samples')).toBe('true');expect(screen.queryByText('Sample')).not.toBeInTheDocument();await user.click(screen.getByLabelText('Select all visible datasets'));expect(screen.getByRole('region',{name:'Selected dataset actions'})).toHaveTextContent('1 selected');await user.click(screen.getByLabelText('Show archived'));expect(screen.getByRole('button',{name:/^archived.csv/})).toBeVisible();expect(screen.queryByRole('region',{name:'Selected dataset actions'})).not.toBeInTheDocument();
});
it('requires exact single confirmation and dependency acknowledgement',async()=>{
 const user=userEvent.setup();vi.mocked(lifecycleApi.dependencies).mockResolvedValue({...empty,has_dependencies:true,groups:{models:[{id:'model1',title:'Real measured model',timestamp:null}]},counts:{models:1}});
 render(<DatasetLifecycleDialog datasets={[dataset]} action="delete" onClose={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} onNavigate={vi.fn()}/>);
 const remove=await screen.findByRole('button',{name:'Delete permanently'});expect(remove).toBeDisabled();await user.type(screen.getByLabelText('Delete confirmation'),'Temporary sales');expect(remove).toBeDisabled();await user.click(screen.getByLabelText(/I acknowledge/));expect(remove).toBeEnabled();await user.click(screen.getAllByText('1 trained model')[1]);expect(screen.getByRole('link',{name:'Real measured model'})).toBeVisible();
});
it('disables single delete for active jobs and warns explicitly about the benchmark',async()=>{vi.mocked(lifecycleApi.dependencies).mockResolvedValue({...empty,delete_blocked:true,benchmark_required:true,benchmark_warning:'Evaluation will become unavailable.'});render(<DatasetLifecycleDialog datasets={[dataset]} action="delete" onClose={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} onNavigate={vi.fn()}/>);expect(await screen.findByText('Evaluation will become unavailable.')).toBeVisible();await userEvent.type(screen.getByLabelText('Delete confirmation'),'Temporary sales');expect(screen.getByRole('button',{name:'Delete permanently'})).toBeDisabled();expect(screen.getByRole('button',{name:'Archive'})).toBeEnabled();});
it('gates bulk deletion with DELETE and reports isolated outcomes',async()=>{
 const user=userEvent.setup();vi.mocked(lifecycleApi.bulkDelete).mockResolvedValue([{id:dataset.id,status:'success',reason:null},{id:archived.id,status:'blocked',reason:'Active job'}]);render(<DatasetLifecycleDialog datasets={[dataset,archived]} action="delete" onClose={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} onNavigate={vi.fn()}/>);
 const remove=await screen.findByRole('button',{name:'Delete permanently'});await user.type(screen.getByLabelText('Delete confirmation'),'delete');expect(remove).toBeDisabled();await user.clear(screen.getByLabelText('Delete confirmation'));await user.type(screen.getByLabelText('Delete confirmation'),'DELETE');await user.click(remove);expect(await screen.findByRole('status')).toHaveTextContent('Active job');expect(within(screen.getByRole('status')).getByText(/Temporary sales: success/)).toBeVisible();
});

it('uses bulk confirmation even when the bulk bar has one selected dataset',async()=>{const user=userEvent.setup();vi.mocked(lifecycleApi.bulkDelete).mockResolvedValue([{id:dataset.id,status:'success',reason:null}]);render(<DatasetLifecycleDialog datasets={[dataset]} action="delete" bulkAction onClose={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} onNavigate={vi.fn()}/>);const remove=await screen.findByRole('button',{name:'Delete permanently'});await user.type(screen.getByLabelText('Delete confirmation'),'Temporary sales');expect(remove).toBeDisabled();await user.clear(screen.getByLabelText('Delete confirmation'));await user.type(screen.getByLabelText('Delete confirmation'),'DELETE');await user.click(remove);await waitFor(()=>expect(lifecycleApi.bulkDelete).toHaveBeenCalled());expect(lifecycleApi.delete).not.toHaveBeenCalled();});

const real:Dataset={...dataset,id:'real-1',name:'InsightIQ_Retail_Demo_2400.csv',display_name:null,is_sample:false};
const renderWith=(onChanged=vi.fn().mockResolvedValue(undefined))=>{render(<DatasetManager datasets={[dataset,real,{...dataset,id:'test-4',name:'two.csv',display_name:'Second sample'}]} selected={real} query="" onSelect={vi.fn()} onChanged={onChanged} onNavigate={vi.fn()} allowNavigation={()=>true} onHistory={vi.fn()}/>);return onChanged};
it('a demo-named file is NOT a sample until the owner marks it; the row menu marks and unmarks',async()=>{
 const user=userEvent.setup();vi.mocked(lifecycleApi.bulkSample).mockResolvedValue({updated:1,is_sample:true});const changed=renderWith();
 const row=screen.getByLabelText(/Actions for InsightIQ_Retail_Demo_2400/).closest('tr')!;expect(within(row).queryByText('Sample')).not.toBeInTheDocument();
 await user.click(screen.getByLabelText(/Actions for InsightIQ_Retail_Demo_2400/));await user.click(screen.getByRole('menuitem',{name:'Mark as sample'}));
 await waitFor(()=>expect(lifecycleApi.bulkSample).toHaveBeenCalledWith(['real-1'],true));await waitFor(()=>expect(changed).toHaveBeenCalled());
 await user.click(screen.getByLabelText('Actions for Temporary sales'));expect(screen.getByRole('menuitem',{name:'Not a sample'})).toBeVisible();
});
it('Select all samples selects only the visible sample rows, and the bulk bar can unmark them',async()=>{
 const user=userEvent.setup();vi.mocked(lifecycleApi.bulkSample).mockResolvedValue({updated:2,is_sample:false});renderWith();
 await user.click(screen.getByRole('button',{name:'Select all samples'}));
 expect(screen.getByText('2 selected')).toBeVisible();expect(screen.getByRole('button',{name:'Mark as sample'})).toBeDisabled();
 await user.click(screen.getByRole('button',{name:'Not a sample'}));await waitFor(()=>expect(lifecycleApi.bulkSample).toHaveBeenCalledWith(['test-1','test-4'],false));
 expect(lifecycleApi.bulkArchive).not.toHaveBeenCalled();                                  // selecting never archives by itself
});
it('with sample data hidden there is nothing to select, so Select all samples is absent',async()=>{
 const user=userEvent.setup();renderWith();await user.click(screen.getByLabelText('Hide sample data'));expect(screen.queryByRole('button',{name:'Select all samples'})).not.toBeInTheDocument();
});
