import{o as st,A as x,a1 as mt,ao as gt}from"./index-aMOhLLH6.js";import{f as ft}from"./validation-C3eAGjiO.js";import{e as ht}from"./documentMappers-CEqU_WQv.js";import{r as xt,t as vt,S as wt}from"./tncDefaults-Oc-zraas.js";function e(a){return a?String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):""}function $t(a,t,r){let i=a,f=r||null,c=t||null;if(typeof a=="object"&&a!==null){const n=a;i=n.payment_date||n.date||n.invoice_date||null,f=n.invoice_time||n.time||n.payment_time||null,c=n.created_at||null}if(!i&&c){const n=new Date(c);if(!isNaN(n.getTime())){const d=String(n.getDate()).padStart(2,"0"),l=String(n.getMonth()+1).padStart(2,"0"),p=n.getFullYear();let s=n.getHours();const b=String(n.getMinutes()).padStart(2,"0"),D=s>=12?"PM":"AM";return s=s%12||12,`${d}/${l}/${p}, ${String(s).padStart(2,"0")}:${b} ${D}`}}if(!i)return"—";let m="";if(typeof i=="string"){const n=i.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/),d=i.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(n){const[,l,p,s]=n;m=`${s.padStart(2,"0")}/${p.padStart(2,"0")}/${l}`}else if(d){const[,l,p,s]=d;m=`${l.padStart(2,"0")}/${p.padStart(2,"0")}/${s}`}else{const l=new Date(i);if(isNaN(l.getTime()))m=String(i);else{const p=String(l.getDate()).padStart(2,"0"),s=String(l.getMonth()+1).padStart(2,"0"),b=l.getFullYear();m=`${p}/${s}/${b}`}}}else if(i instanceof Date&&!isNaN(i.getTime())){const n=String(i.getDate()).padStart(2,"0"),d=String(i.getMonth()+1).padStart(2,"0"),l=i.getFullYear();m=`${n}/${d}/${l}`}else m=String(i);let g="";if(f&&typeof f=="string"){const n=f.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)$/i),d=f.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);if(n){let l=parseInt(n[1],10);const p=n[2],s=n[3].toUpperCase();l=l%12||12,g=`${String(l).padStart(2,"0")}:${p} ${s}`}else if(d){let l=parseInt(d[1],10);const p=d[2],s=l>=12?"PM":"AM";l=l%12||12,g=`${String(l).padStart(2,"0")}:${p} ${s}`}else g=f.trim()}else if(c){const n=new Date(c);if(!isNaN(n.getTime())){let d=n.getHours();const l=String(n.getMinutes()).padStart(2,"0"),p=d>=12?"PM":"AM";d=d%12||12,g=`${String(d).padStart(2,"0")}:${l} ${p}`}}return g||(g="12:00 AM"),`${m}, ${g}`}const yt=`
  @page {
    size: A4 portrait;
    margin: 12mm 15mm;
  }
  @media print {
    *, *::before, *::after {
      box-sizing: border-box !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      color: #1e293b !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
  .receipt-container {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.5;
    color: #1e293b;
    background: #ffffff;
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 32px;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .receipt-container *,
  .receipt-container *::before,
  .receipt-container *::after {
    box-sizing: border-box;
  }
  .receipt-header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .receipt-header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 6px;
  }
  .biz-branding {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .biz-logo-img {
    height: 44px;
    width: auto;
    max-width: 180px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .biz-logo-badge {
    height: 36px;
    width: 36px;
    border-radius: 10px;
    background-color: #047857;
    color: #ffffff;
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: 16px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .biz-name-col {
    display: flex;
    flex-direction: column;
  }
  .biz-title {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.5px;
    color: #064e3b;
    line-height: 1.15;
  }
  .biz-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
  }
  .doc-badge {
    display: inline-block;
    border-radius: 6px;
    background-color: #ecfdf5;
    border: 1px solid #a7f3d0;
    padding: 4px 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .badge-title {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #064e3b;
    display: block;
  }
  .badge-subtitle {
    margin: 2px 0 0 0;
    font-size: 9px;
    font-weight: 600;
    color: #047857;
  }
  .header-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1px 0;
    line-height: 1.35;
  }
  .header-col-left {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
    color: #475569;
    display: flex;
    align-items: baseline;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-col-left .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-left .val {
    color: #334155;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-left .val-mono {
    font-size: 11px;
    font-weight: 600;
  }
  .header-col-right {
    flex: 0 0 auto;
    text-align: right;
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 6px;
    font-size: 11px;
    line-height: 1.35;
    white-space: nowrap;
  }
  .header-col-right .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-right .val {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
  }
  .header-col-right strong {
    color: #0f172a;
    font-size: 11.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 700;
  }
  .two-col-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    padding: 12px 18px;
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.7);
    border: 1px solid rgba(226, 232, 240, 0.8);
    margin-bottom: 16px;
  }
  .card-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .payment-details-col {
    border-left: 1px solid #e2e8f0;
    padding-left: 20px;
  }
  .card-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .card-icon {
    width: 13px;
    height: 13px;
    color: #94a3b8;
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
  .card-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .card-row {
    display: flex;
    align-items: baseline;
    font-size: 11px;
    line-height: 1.35;
    padding: 1px 0;
    color: #475569;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    white-space: nowrap;
  }
  .card-party-name {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
  }
  .customer-card-col .card-row {
    color: #475569;
    font-weight: 400;
  }
  .customer-card-col .card-party-name {
    font-weight: 700 !important;
    color: #0f172a !important;
  }
  .customer-card-col .val,
  .customer-card-col .val-mono {
    font-weight: 400 !important;
    color: #475569 !important;
    font-size: 11px;
  }
  .customer-card-col .label {
    font-weight: 400 !important;
    color: #64748b !important;
    font-size: 11px;
  }
  .customer-card-col .pipe-sep {
    color: #cbd5e1;
    margin: 0 5px;
    font-weight: 400;
  }
  .customer-card-col .party-gstin-pill,
  .customer-card-col .party-pan-pill,
  .customer-card-col .party-aadhaar-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    font-size: 10.5px;
    line-height: 1.35;
    font-weight: 400;
    color: #475569;
  }
  .customer-card-col .party-gstin-pill .val-mono,
  .customer-card-col .party-pan-pill .val-mono,
  .customer-card-col .party-aadhaar-pill .val-mono {
    font-weight: 400 !important;
    color: #334155 !important;
    font-size: 10.5px;
  }
  .payment-details-col .card-row {
    color: #334155;
  }
  .payment-details-col .label {
    color: #64748b;
    font-weight: 500;
    font-size: 11px;
  }
  .payment-details-col .val-mono {
    color: #0f172a;
    font-weight: 600;
    font-size: 11px;
  }
  .pipe-sep {
    color: #cbd5e1;
    margin: 0 6px;
    font-weight: 400;
  }
  .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .val {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
  }
  .val-mono {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .party-gstin-pill,
  .party-pan-pill,
  .party-aadhaar-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: 11px;
    line-height: 1.35;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    background: #d1fae5;
    border: 1px solid #a7f3d0;
    color: #065f46;
  }
  .table-box {
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .receipt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .receipt-table thead tr {
    background: rgba(241, 245, 249, 0.8);
    border-bottom: 1px solid #e2e8f0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #475569;
  }
  .receipt-table th {
    padding: 10px 12px;
    text-align: left;
  }
  .receipt-table th.text-center {
    text-align: center;
  }
  .receipt-table th.text-right {
    text-align: right;
  }
  .receipt-table td {
    padding: 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  .receipt-table td.text-center {
    text-align: center;
  }
  .receipt-table td.text-right {
    text-align: right;
  }
  .receipt-table tbody tr:last-child td {
    border-bottom: none;
  }
  .td-desc-title {
    font-weight: 700;
    color: #0f172a;
  }
  .td-desc-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
  }
  .td-desc-note {
    font-size: 10px;
    color: #64748b;
    margin-top: 3px;
    font-style: italic;
  }
  .num-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    padding-top: 6px;
    padding-bottom: 20px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 20px;
  }
  .words-card {
    border-radius: 10px;
    background: #f8fafc;
    padding: 12px 14px;
    border: 1px solid rgba(226, 232, 240, 0.7);
  }
  .words-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 4px;
  }
  .words-val {
    font-size: 11px;
    font-weight: 800;
    font-style: italic;
    color: #0f172a;
    line-height: 1.4;
  }
  .bank-details-card {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
  }
  .bank-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .bank-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
  }
  .bank-rows {
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bank-row {
    display: flex;
    align-items: baseline;
    line-height: 1.4;
    white-space: nowrap;
  }
  .bank-row span.label {
    color: #64748b;
    font-size: 10px;
    width: 65px;
    flex-shrink: 0;
    letter-spacing: 0.2px;
  }
  .bank-row span.val {
    font-weight: 600;
    color: #0f172a;
    font-size: 11px;
  }
  .bank-row span.val-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    color: #0f172a;
    font-size: 11px;
  }
  .totals-col {
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .total-line {
    display: flex;
    justify-content: space-between;
    color: #475569;
    padding: 2px 0;
  }
  .total-line span.val {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    color: #0f172a;
  }
  .grand-total-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 10px;
    background: rgba(236, 253, 245, 0.7);
    border: 1px solid #a7f3d0;
    padding: 10px 14px;
    margin-top: 8px;
  }
  .grand-total-label {
    font-size: 13px;
    font-weight: 900;
    color: #064e3b;
  }
  .grand-total-val {
    font-size: 16px;
    font-weight: 900;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #064e3b;
  }
  .receipt-footer-section {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    padding-top: 14px;
  }
  .terms-box {
    max-width: 440px;
    font-size: 10px;
    color: #64748b;
  }
  .terms-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #334155;
    margin-bottom: 4px;
  }
  .terms-content {
    line-height: 1.5;
  }
  .terms-content p {
    margin: 0 0 2px 0;
  }
  .signatory-box {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 170px;
  }
  .signatory-for {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
    margin-bottom: 4px;
  }
  .sign-img {
    height: 48px;
    max-width: 130px;
    object-fit: contain;
    margin: 4px 0;
  }
  .sign-dashed {
    height: 48px;
    width: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed #cbd5e1;
    border-radius: 4px;
    margin: 4px 0;
  }
  .sign-dashed span {
    font-size: 9px;
    color: #94a3b8;
  }
  .sign-name {
    font-size: 11px;
    font-weight: 700;
    color: #1e293b;
    margin-top: 2px;
  }
  .sign-sub {
    font-size: 9px;
    color: #94a3b8;
  }
  .bottom-disclaimer {
    width: 100%;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
    margin-top: 24px;
    text-align: center;
  }
  .bottom-disclaimer p {
    font-size: 9px;
    color: #94a3b8;
    letter-spacing: 0.4px;
    margin: 0;
  }
`;function bt(a,t,r){var K,Z,J,Q;const i=(r==null?void 0:r.docType)==="voucher"||a.type==="made"||!!(a.supplier&&!a.customer),f=(r==null?void 0:r.docTitle)||(i?"PAYMENT VOUCHER":"PAYMENT RECEIPT"),c=(r==null?void 0:r.docSubtitle)||(i?"Original Payment Advice":"Original for Recipient"),m=(r==null?void 0:r.numberLabel)||(i?"Voucher No:":"Receipt No:"),g=(r==null?void 0:r.dateTimeLabel)||(i?"Voucher Date & Time:":"Receipt Date & Time:"),n=(r==null?void 0:r.partyLabel)||(i?"PAID TO":"RECEIVED FROM"),d=(r==null?void 0:r.statusLabel)||(i?"✓ PAID":"✓ RECEIVED"),l=(t==null?void 0:t.currency_symbol)||"₹",p=(t==null?void 0:t.legal_name)||(t==null?void 0:t.legalName)||(t==null?void 0:t.name)||"Avadh Boring Company",s=String((t==null?void 0:t.trade_name)||(t==null?void 0:t.tradeName)||"").trim(),b=s.length>0&&s.toLowerCase()!==String(p).trim().toLowerCase(),D=p.charAt(0).toUpperCase(),j=(t==null?void 0:t.logo_url)||(t==null?void 0:t.logoUrl)||(t==null?void 0:t.logo)||null,X=(t==null?void 0:t.address)||(t==null?void 0:t.addressLine1)||"",tt=[[t==null?void 0:t.city,t==null?void 0:t.state].filter(Boolean).join(", "),t!=null&&t.pincode?`- ${t.pincode}`:t!=null&&t.pin_code?`- ${t.pin_code}`:""].filter(Boolean).join(" "),N=(t==null?void 0:t.phone)||"",M=(t==null?void 0:t.email)||"",v=(t==null?void 0:t.gstin)||"",k=(t==null?void 0:t.pan)||(v.length>=12?v.slice(2,12):""),F=(t==null?void 0:t.signature_url)||(t==null?void 0:t.signatureUrl)||(t==null?void 0:t.stamp_url)||(t==null?void 0:t.stampUrl)||null,at=(t==null?void 0:t.signature_name)||(t==null?void 0:t.signatureName)||"Authorized Signatory",S=ht(t),E=S.bankName||(t==null?void 0:t.bank_name)||(t==null?void 0:t.bankName)||"",H=S.accountHolderName||(t==null?void 0:t.account_name)||(t==null?void 0:t.account_holder_name)||(t==null?void 0:t.accountHolderName)||"",et=H||p,L=S.accountNumber||(t==null?void 0:t.bank_account_no)||(t==null?void 0:t.bank_account_number)||(t==null?void 0:t.accountNumber)||"",B=S.ifsc||(t==null?void 0:t.bank_ifsc)||(t==null?void 0:t.bank_ifsc_code)||(t==null?void 0:t.ifsc)||"",O=S.upiId||(t==null?void 0:t.upi_id)||(t==null?void 0:t.upiId)||"",ot=!!(E||L||B||O||H),o=a.supplier||a.customer||a.party,lt=(o==null?void 0:o.name)||(o==null?void 0:o.company_name)||a.supplier_name||a.customer_name||(i?"Supplier":"Customer"),R=String((o==null?void 0:o.phone)||"").trim(),A=String((o==null?void 0:o.email)||"").trim(),Y=String((o==null?void 0:o.address)||(o==null?void 0:o.street)||"").trim(),rt=String((o==null?void 0:o.city)||"").trim(),nt=String((o==null?void 0:o.state)||"").trim(),P=String((o==null?void 0:o.pincode)||(o==null?void 0:o.pin_code)||"").trim(),h=String((o==null?void 0:o.gstin)||"").trim(),w=String((o==null?void 0:o.pan)||(h.length>=12?h.slice(2,12):"")).trim(),$=String((o==null?void 0:o.aadhaar)||"").trim();let z="";const T=[rt,nt].filter(Boolean).join(", ");T&&P?z=`${T} - ${P}`:T?z=T:P&&(z=P);const y=Number(a.amount)||0,_=a.round_off!==void 0?a.round_off:a.roundOff!==void 0?a.roundOff:a==null?void 0:a.roundoff,V=Number((Math.round(y)-y).toFixed(2)),U=_!=null&&Number(_)!==0?Number(_):Math.abs(V)>1e-4?V:0,G=Math.round(y+U),u=Number(a.allocated_amount)||0,C=Math.max(0,y-u),W=(a.payment_method||"cash").toUpperCase().replace("_"," "),it=gt(G),ct=$t(a.payment_date||a.invoice_date||a.date,a.created_at,a.invoice_time||a.time),q=xt("payment_receipt",t,a.terms),dt=q.length>0?q:vt(wt.payment_receipt);return`
    <div class="receipt-container">
      <!-- 1. Header Section -->
      <div class="receipt-header">
        <div class="receipt-header-top">
          <div class="biz-branding">
            ${j?`
              <img src="${e(j)}" alt="${e(p)}" class="biz-logo-img" />
            `:`
              <span class="biz-logo-badge">${e(D)}</span>
            `}
            <div class="biz-name-col">
              <span class="biz-title">${e(p)}</span>
              ${b?`<div class="biz-subtitle">${e(s)}</div>`:""}
            </div>
          </div>

          <div class="doc-badge">
            <span class="badge-title">${e(f)}</span>
            <p class="badge-subtitle">${e(c)}</p>
          </div>
        </div>

        <!-- Single-Row Pairs: Business Info (Left) | Receipt Metadata (Right) -->
        <div class="header-rows">
          <!-- Row 1: Street Address (Left) | Receipt No (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              <span>${e(X||"AN-25, Lautabagh, Azadnagar, Nawabganj")}</span>
            </div>
            <div class="header-col-right">
              <span class="label">${e(m)}</span>
              <strong>${e(a.payment_number)}</strong>
            </div>
          </div>

          <!-- Row 2: City, State - Pincode (Left) | Receipt Date & Time (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              <span>${e(tt||"Barabanki, Uttar Pradesh - 225001")}</span>
            </div>
            <div class="header-col-right">
              <span class="label">${e(g)}</span>
              <span class="val">${e(ct)}</span>
            </div>
          </div>

          <!-- Row 3: GSTIN | PAN (Left) | Payment Mode (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              ${v||k?`
                ${v?`<span class="label">GSTIN:</span> <strong class="val-mono">${e(v)}</strong>`:""}
                ${v&&k?'<span class="pipe-sep">|</span>':""}
                ${k?`<span class="label">PAN:</span> <strong class="val-mono">${e(k)}</strong>`:""}
              `:"<span>&nbsp;</span>"}
            </div>
            <div class="header-col-right">
              <span class="label">Payment Mode:</span>
              <span class="val">${e(W)}</span>
            </div>
          </div>

          <!-- Row 4: Phone | Email (Left) | Ref / Instrument No (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              ${N||M?`
                ${N?`<span class="label">Phone:</span> <span class="val">${e(N)}</span>`:""}
                ${N&&M?'<span class="pipe-sep">|</span>':""}
                ${M?`<span class="label">Email:</span> <span class="val">${e(M)}</span>`:""}
              `:"<span>&nbsp;</span>"}
            </div>
            <div class="header-col-right">
              ${a.reference?`
                <span class="label">Ref / Instrument No:</span>
                <span class="val-mono">${e(a.reference)}</span>
              `:"<span>&nbsp;</span>"}
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Two-Column Info Cards -->
      <div class="two-col-cards">
        <div class="card-col customer-card-col">
          <div class="card-label">
            <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>
            ${e(n)}
          </div>
          <div class="card-rows">
            <!-- Row 1: Customer Name (Bold) -->
            <div class="card-row">
              <span class="card-party-name">${e(lt)}</span>
            </div>

            <!-- Row 2: Phone | Email (clean values without label prefixes) -->
            ${R||A?`
            <div class="card-row">
              ${R?`<span class="val">${e(R)}</span>`:""}
              ${R&&A?'<span class="pipe-sep">|</span>':""}
              ${A?`<span class="val">${e(A)}</span>`:""}
            </div>
            `:""}

            <!-- Row 3: Street Address (clean value without Address: label) -->
            ${Y?`
            <div class="card-row">
              <span class="val">${e(Y)}</span>
            </div>
            `:""}

            <!-- Row 4: City, State - Pincode (e.g. Barabanki, Uttar Pradesh - 225001) -->
            ${z?`
            <div class="card-row">
              <span class="val">${e(z)}</span>
            </div>
            `:""}

            <!-- Row 5: PAN: [PAN] | Aadhaar: [Aadhaar] (Keep identity badges/labels) -->
            ${h||w||$?`
            <div class="card-row">
              ${h?`<span class="party-gstin-pill"><span class="label">GSTIN:</span> <span class="val-mono">${e(h)}</span></span>`:""}
              ${h&&(w||$)?'<span class="pipe-sep">|</span>':""}
              ${w?`<span class="party-pan-pill"><span class="label">PAN:</span> <span class="val-mono">${e(w)}</span></span>`:""}
              ${w&&$?'<span class="pipe-sep">|</span>':""}
              ${$?`<span class="party-aadhaar-pill"><span class="label">Aadhaar:</span> <span class="val-mono">${e(ft($))}</span></span>`:""}
            </div>
            `:""}
          </div>
        </div>

        <div class="card-col payment-details-col">
          <div class="card-label">
            <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
            PAYMENT DETAILS
          </div>
          <div class="card-rows">
            <!-- Row 1: Payment Date: DD/MM/YYYY -->
            <div class="card-row card-row-between">
              <span class="label">Payment Date:</span>
              <span class="val-mono">${e(st(a.payment_date||a.date))}</span>
            </div>

            <!-- Row 2: Ref / Instrument No: [ref] -->
            <div class="card-row card-row-between">
              <span class="label">Ref / Instrument No:</span>
              <span class="val-mono">${a.reference?e(a.reference):"—"}</span>
            </div>

            <!-- Row 3: Payment Method: CASH (or Bank Transfer / Cheque) -->
            <div class="card-row card-row-between">
              <span class="label">Payment Method:</span>
              <span class="val-mono">${e(W)}</span>
            </div>

            <!-- Row 4: Payment Status: [RECEIVED / PAID badge] -->
            <div class="card-row card-row-between">
              <span class="label">Payment Status:</span>
              <span class="status-pill">${e(d)}</span>
            </div>

            <!-- Row 5: Matching spacer row to maintain 1:1 row symmetry with Left Card if 5th row present -->
            ${h||w||$?`
            <div class="card-row card-row-between" style="visibility: hidden;">
              <span class="label">&nbsp;</span>
              <span class="val">&nbsp;</span>
            </div>
            `:""}
          </div>
        </div>
      </div>

      <!-- 3. Particulars Table -->
      <div class="table-box">
        <table class="receipt-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 5%">#</th>
              <th style="width: 45%">${i?"DESCRIPTION / BILL REF":"DESCRIPTION / INVOICE REF"}</th>
              <th class="text-right" style="width: 16%">ORIGINAL AMOUNT</th>
              <th class="text-right" style="width: 16%">ALLOCATED AMOUNT</th>
              <th class="text-right" style="width: 18%">UNALLOCATED / BALANCE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-center num-mono" style="color: #94a3b8; font-size: 11px;">1</td>
              <td>
                <div class="td-desc-title">
                  ${(K=a.bill)!=null&&K.bill_number?`Purchase Bill ${e(a.bill.bill_number)}`:(Z=a.invoice)!=null&&Z.invoice_number?`Invoice ${e(a.invoice.invoice_number)}`:i?"Payment made — On Account / Advance":"Payment received — On Account / Advance"}
                </div>
                <div class="td-desc-sub">
                  ${(J=a.bill)!=null&&J.bill_number?"Payment allocated against open purchase bill":(Q=a.invoice)!=null&&Q.invoice_number?"Payment allocated against open sales invoice":i?"Unallocated payment debited to supplier ledger":"Unallocated receipt credited to customer ledger"}
                </div>
                ${a.notes?`<div class="td-desc-note">Note: ${e(a.notes)}</div>`:""}
              </td>
              <td class="text-right num-mono" style="font-weight: 600; color: #334155;">
                ${x(y,l)}
              </td>
              <td class="text-right num-mono" style="font-weight: 600; color: #334155;">
                ${u>0?x(u,l):"—"}
              </td>
              <td class="text-right num-mono" style="font-weight: 700; color: #0f172a;">
                ${C>0?x(C,l):"—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 4. Summary & Bank Details Section -->
      <div class="summary-grid">
        <div>
          <div class="words-card">
            <div class="words-label">AMOUNT IN WORDS</div>
            <div class="words-val">${e(it)}</div>
          </div>

          ${ot?`
            <div class="bank-details-card">
              <div class="bank-header">
                <svg style="width: 12px; height: 12px; color: #94a3b8; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="6" y2="6"/><line x1="10" x2="10" y1="18" y2="18"/><line x1="14" x2="14" y1="18" y2="18"/><line x1="18" x2="18" y1="18" y2="18"/><line x1="6" x2="6" y1="18" y2="18"/><path d="M2 18v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2"/><path d="m12 2 10 4H2l10-4Z"/></svg>
                <span class="bank-title">BANK &amp; PAYMENT DETAILS</span>
              </div>
              <div class="bank-rows">
                ${E?`<div class="bank-row"><span class="label">Bank:</span><span class="val">${e(E)}</span></div>`:""}
                ${`<div class="bank-row"><span class="label">A/C Name:</span><span class="val">${e(et)}</span></div>`}
                ${L?`<div class="bank-row"><span class="label">A/C No:</span><span class="val-mono">${e(L)}</span></div>`:""}
                ${B?`<div class="bank-row"><span class="label">IFSC:</span><span class="val-mono">${e(B)}</span></div>`:""}
                ${O?`<div class="bank-row"><span class="label">UPI:</span><span class="val">${e(O)}</span></div>`:""}
              </div>
            </div>
          `:""}
        </div>

        <div class="totals-col">
          <div class="total-line">
            <span>Total Amount:</span>
            <span class="val">${x(y,l)}</span>
          </div>
          <div class="total-line">
            <span>${i?"Applied to Bills:":"Applied to Invoices:"}</span>
            <span class="val">${u>0?x(u,l):"—"}</span>
          </div>
          <div class="total-line">
            <span>Unallocated / Balance:</span>
            <span class="val">${C>0?x(C,l):"—"}</span>
          </div>
          ${U!==0?`
          <div class="total-line">
            <span>Round Off:</span>
            <span class="val">${mt(U,l)}</span>
          </div>
          `:""}
          <div class="grand-total-bar">
            <span class="grand-total-label">${i?"Total Paid (INR):":"Total Received (INR):"}</span>
            <span class="grand-total-val">${x(G,l)}</span>
          </div>
        </div>
      </div>

      <!-- 5. Footer -->
      <div class="receipt-footer-section">
        <div class="terms-box">
          <div class="terms-title">Terms &amp; Notes:</div>
          <div class="terms-content">
            ${dt.map(pt=>`<p>• ${e(pt.replace(/^[•\-\*]\s*/,""))}</p>`).join(`
            `)}
            ${a.notes?`<p style="color: #0f172a; font-weight: 600;">• Note: ${e(a.notes)}</p>`:""}
          </div>
        </div>

        <div class="signatory-box">
          <div class="signatory-for">
            FOR ${e(p.toUpperCase())}
          </div>
          ${F?`
            <img src="${F}" alt="Authorized Signature" class="sign-img" />
          `:`
            <div class="sign-dashed">
              <span>Authorized Signatory</span>
            </div>
          `}
          <div class="sign-name">${e(at)}</div>
          <div class="sign-sub">Authorized Signatory</div>
        </div>
      </div>

      <!-- Center Bottom Disclaimer -->
      <div class="bottom-disclaimer">
        <p>${i?"This is a computer generated payment voucher.":"This is a computer generated receipt."}</p>
      </div>
    </div>
  `}let I=!1;function St(a,t,r){var g;if(I)return;I=!0;const i=bt(a,t,r),f=(r==null?void 0:r.docTitle)||((r==null?void 0:r.docType)==="voucher"||a.type==="made"?"Payment Voucher":"Payment Receipt"),c=document.createElement("iframe");c.style.position="fixed",c.style.right="0",c.style.bottom="0",c.style.width="0px",c.style.height="0px",c.style.border="none",document.body.appendChild(c);const m=(g=c.contentWindow)==null?void 0:g.document;if(!m){I=!1;return}m.open(),m.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${e(f)} ${e(a.payment_number)}</title>
        <style>
          ${yt}
        </style>
      </head>
      <body>
        ${i}
      </body>
    </html>
  `),m.close(),setTimeout(()=>{var n,d;try{(n=c.contentWindow)==null||n.focus(),(d=c.contentWindow)==null||d.print()}catch(l){console.warn("print error",l)}setTimeout(()=>{try{c.parentNode&&c.parentNode.removeChild(c)}catch{}I=!1},1500)},350)}function kt(a,t,r){St(a,t,{docType:"voucher",...r})}export{yt as R,kt as a,$t as f,bt as g,St as p};
