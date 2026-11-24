/**
 * The unit label the owner typed when setting up a model. It is shown as exactly that: a label you typed.
 * It is not checked, not confirmed and never converted. (Stage 6: the old browser-only "Confirm" button is gone;
 * values it saved earlier in this browser are neither read, rewritten nor deleted.)
 */
export default function UnitConfirmation({stored}:{id?:string;stored:string|null|undefined}){
 if(!stored)return null;
 return <section className="unit-confirmation" aria-label="Unit label you typed"><p>Unit label you typed: <strong>{stored}</strong></p><small>This is a label you typed when you set up the model. It is not checked, and no currency conversion is applied.</small></section>
}
