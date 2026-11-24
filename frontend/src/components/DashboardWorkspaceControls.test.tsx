import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi,beforeEach} from 'vitest';
import {WidgetTitle,DashboardMenu,DuplicateDialog,DashboardCurrency} from './DashboardWorkspaceControls';
import {request} from '../api';
import {setCurrencyQuotes} from '../lib/currency';
import type {Widget} from '../phase4api';
vi.mock('../api',()=>({request:vi.fn()}));
vi.mock('../lib/currency',()=>({currencies:['INR','USD','EUR'],setCurrencyQuotes:vi.fn()}));
const widget={id:'w',title:'raw_revenue',display_title:'Revenue',custom_title:null,kind:'chart',result:{columns:[{name:'amount',type:'DOUBLE',money:{currency:'INR'}}],rows:[[8379680.76]],row_count:1}} as Widget;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear()});
it('inline title saves with Enter, validates, cancels with Escape and resets',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);const {rerender}=render(<WidgetTitle widget={widget} disabled={false} onSave={save}/>);
 await userEvent.click(screen.getByRole('button',{name:'Revenue'}));const input=screen.getByLabelText('Widget title');await userEvent.clear(input);await userEvent.keyboard('{Enter}');expect(screen.getByRole('alert')).toHaveTextContent('1 to 120');expect(save).not.toHaveBeenCalled();
 await userEvent.type(input,'Reviewed revenue');await userEvent.keyboard('{Enter}');await waitFor(()=>expect(save).toHaveBeenCalledWith('Reviewed revenue'));
 await userEvent.click(screen.getByRole('button',{name:'Revenue'}));await userEvent.keyboard('{Escape}');expect(screen.queryByLabelText('Widget title')).not.toBeInTheDocument();
 rerender(<WidgetTitle widget={{...widget,custom_title:'Reviewed'}} disabled={false} onSave={save}/>);await userEvent.click(screen.getByRole('button',{name:'Reset to default'}));expect(save).toHaveBeenLastCalledWith(null);
});
it('overflow keyboard arrows and Escape return focus',async()=>{
 render(<DashboardMenu><button role="menuitem">Duplicate</button><button role="menuitem">Delete</button></DashboardMenu>);
 const trigger=screen.getByRole('button',{name:'More actions'});expect(trigger).toHaveAttribute('aria-haspopup','menu');await userEvent.click(trigger);expect(screen.getByRole('menuitem',{name:'Duplicate'})).toHaveFocus();await userEvent.keyboard('{ArrowDown}');expect(screen.getByRole('menuitem',{name:'Delete'})).toHaveFocus();await userEvent.keyboard('{Escape}');expect(screen.queryByRole('menu')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});
it('duplicate choices are explicit Replace, Add anyway or Cancel',async()=>{
 const choose=vi.fn();render(<DuplicateDialog disabled={false} onChoice={choose}/>);
 for(const [label,value] of [['Replace','replace'],['Add anyway','add_anyway'],['Cancel','cancel']]){await userEvent.click(screen.getByRole('button',{name:label}));expect(choose).toHaveBeenLastCalledWith(value)}
});
it('display currency fetches one quote per pair, resets without mutating rows',async()=>{
 const before=JSON.stringify(widget);const onTarget=vi.fn();vi.mocked(request).mockResolvedValue({source_currency:'INR',target_currency:'USD',rate:'0.0125',effective_date:'2026-11-10',rate_source:'Controlled daily reference'});
 render(<DashboardCurrency dashboardId="d1" widgets={[widget,{...widget,id:'w2'}]} onTarget={onTarget}/>);
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'USD');await screen.findByText(/1 INR = 0.0125 USD/);expect(request).toHaveBeenCalledTimes(1);expect(setCurrencyQuotes).toHaveBeenCalledWith('w',expect.objectContaining({INR:expect.objectContaining({rate:'0.0125'})}));
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'');expect(setCurrencyQuotes).toHaveBeenLastCalledWith('w2',{});expect(JSON.stringify(widget)).toBe(before);
});
it('rate failure is visible and unconfirmed values stay unconverted',async()=>{
 vi.mocked(request).mockRejectedValue(new Error('Provider unavailable'));
 render(<DashboardCurrency dashboardId="d1" widgets={[widget,{...widget,id:'count',result:{columns:[{name:'orders',type:'BIGINT'}],rows:[[3]],row_count:1}}]} onTarget={vi.fn()}/>);
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'USD');expect(await screen.findByRole('alert')).toHaveTextContent('Original currency retained');expect(screen.getByText(/No confirmed currency/)).toBeVisible();expect(setCurrencyQuotes).toHaveBeenLastCalledWith('count',{});
});

it('remembers the display currency per dashboard in this browser and restores it on return',async()=>{
 vi.mocked(request).mockResolvedValue({source_currency:'INR',target_currency:'USD',rate:'0.0125',effective_date:'2026-11-10',rate_source:'Controlled daily reference'});
 const first=render(<DashboardCurrency dashboardId="a" widgets={[widget]} onTarget={vi.fn()}/>);
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'USD');await screen.findByText(/1 INR = 0.0125 USD/);
 expect(localStorage.getItem('insightiq-dashboard-currency:a')).toBe('USD');
 first.unmount();const onTarget=vi.fn();
 render(<DashboardCurrency dashboardId="a" widgets={[widget]} onTarget={onTarget}/>);
 expect(screen.getByLabelText('Report currency')).toHaveValue('USD');await waitFor(()=>expect(onTarget).toHaveBeenLastCalledWith('USD'));
 cleanup();render(<DashboardCurrency dashboardId="b" widgets={[widget]} onTarget={vi.fn()}/>);
 expect(screen.getByLabelText('Report currency')).toHaveValue('');                       // another dashboard is unaffected
 cleanup();render(<DashboardCurrency dashboardId="a" widgets={[widget]} onTarget={vi.fn()}/>);
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'');expect(localStorage.getItem('insightiq-dashboard-currency:a')).toBeNull();
});
it('ignores a remembered value that is not a listed currency and survives blocked storage',async()=>{
 localStorage.setItem('insightiq-dashboard-currency:z','NOT-A-CURRENCY');
 const {unmount}=render(<DashboardCurrency dashboardId="z" widgets={[widget]} onTarget={vi.fn()}/>);expect(screen.getByLabelText('Report currency')).toHaveValue('');unmount();
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('denied')});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied')});vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('denied')});
 vi.mocked(request).mockResolvedValue({source_currency:'INR',target_currency:'USD',rate:'0.0125',effective_date:'2026-11-10',rate_source:'Controlled daily reference'});
 render(<DashboardCurrency dashboardId="q" widgets={[widget]} onTarget={vi.fn()}/>);
 await userEvent.selectOptions(screen.getByLabelText('Report currency'),'USD');await screen.findByText(/1 INR = 0.0125 USD/);   // still works for this visit
 vi.restoreAllMocks();
});
