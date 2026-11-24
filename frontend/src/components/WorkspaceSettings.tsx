import {useDefaultCurrency,CURRENCY_CHOICES} from "../lib/defaultCurrency";
import {useTechnicalDetails} from "../lib/technicalDetails";
import {PageHeader} from "./ui/layout";

/** Existing browser preferences only; this page never writes server configuration. */
export default function WorkspaceSettings() {
  const [technical,setTechnical]=useTechnicalDetails();
  const [currency,setCurrency]=useDefaultCurrency();
  return <div className="settings-page">
    <PageHeader title="Settings" description="Preferences for this browser." />
    <section className="settings-section" aria-labelledby="workspace-preferences">
      <h2 id="workspace-preferences">Workspace</h2>
      <label className="setting-row"><span><strong>Currency offered for money columns</strong><small>When you confirm that a number column is money, this is the currency we offer. Nothing is marked as money until you confirm it, and you can change the currency per dataset at any time.</small></span><select aria-label="Currency offered for money columns" value={currency??"none"} onChange={e=>setCurrency(e.target.value==="none"?null:e.target.value)}>{CURRENCY_CHOICES.map(c=><option key={c} value={c}>{c}{c==="USD"?" (default)":""}</option>)}<option value="none">None: do not offer a currency</option></select></label>
      <label className="setting-row"><span><strong>Show technical details</strong><small>Show the SQL query, evidence codes and result digests next to answers and dashboard tiles. Off by default: the answer, its data and a plain explanation are always shown.</small></span><input type="checkbox" checked={technical} onChange={e=>setTechnical(e.target.checked)}/></label>
    </section>
    <section className="settings-section" aria-labelledby="local-configuration"><h2 id="local-configuration">Local configuration</h2><p>AI provider credentials and model configuration are managed in the local environment. Restart the API after changing them.</p><p>This workspace is local and single-user. These browser preferences do not change datasets, models or saved results.</p></section>
  </div>;
}
