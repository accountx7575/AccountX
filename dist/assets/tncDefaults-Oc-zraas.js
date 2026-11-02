const u={sales_invoice:`Goods once sold will not be taken back or exchanged.
Redemption / delivery is subject to agreed operational timelines.
This is a computer-generated document and requires no physical signature.`,quotation:`Prices valid for 15 days from the date of this quotation unless otherwise agreed.
All payments to be drawn in favour of the business.
Subject to final order confirmation.`,sales_order:`Deliveries subject to stock availability and confirmed schedule.
Standard packaging unless specified otherwise.
Orders once confirmed cannot be cancelled without mutual agreement.`,purchase:`Goods received are subject to inspection and acceptance as per the purchase order.
Please quote this bill number in all future correspondence.
This is a computer-generated document and requires no physical signature.`,payment_receipt:`All payments are subject to realization of cheque / electronic transfer.
Any discrepancy must be reported to the accounts department within 7 days.
This is a computer-generated receipt.`},c="accountx_tnc_",i={sales_invoice:"tnc_invoice",quotation:"tnc_quotation",sales_order:"tnc_sales_order",purchase:"tnc_purchase",payment_receipt:"tnc_payment_receipt"};function o(t,e){return`${c}${e}_${t||"none"}`}function p(t,e){typeof window>"u"||Object.keys(e).forEach(n=>{try{const r=String(e[n]||"").trim();r?window.localStorage.setItem(o(t,n),r):window.localStorage.removeItem(o(t,n))}catch{}})}function d(t,e){if(typeof window>"u")return"";try{return String(window.localStorage.getItem(o(t,e))||"").trim()}catch{return""}}function l(t,e){const n=e==null?void 0:e[i[t]],r=t==="payment_receipt"?(e==null?void 0:e.terms_payment_receipt)||(e==null?void 0:e.termsPaymentReceipt):void 0,a=String(n||r||"").trim();return a||d(e==null?void 0:e.id,t)}function m(t){return t.split(`
`).map(e=>e.trim()).filter(Boolean)}function s(t,e,n){const r=String(n||"").trim();return m(r||l(t,e))}export{u as S,d as a,s as r,p as s,m as t};
