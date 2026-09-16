'use strict';

// ── EXTERNA RAPPORTERINGSKANALER ─────────────────────────────────
// Enligt lagen (2021:890) ska vi informera om att man kan rapportera
// till en behörig myndighet i stället för, eller utöver, vår interna
// kanal. Källa: HR:s lista "links and actor.xlsx".
//
// Myndigheternas ansvarsområden beskrivs med ett fåtal standardmeningar
// ur förordningen (2021:949). De står här en gång var, översatta, och
// kombineras per aktör, så att samma område alltid formuleras likadant.

const EXTERNAL_AREAS = {
  productSafety: {
    sv: 'Produktsäkerhet och produktöverensstämmelse.',
    en: 'Product safety and product compliance.',
  },
  productSafetyGuidance: {
    sv: 'Produktsäkerhet och produktöverensstämmelse, inom ansvaret för tillsynsvägledning.',
    en: 'Product safety and product compliance, within the responsibility for supervisory guidance.',
  },
  environment: {
    sv: 'Miljöskydd.',
    en: 'Environmental protection.',
  },
  environmentGuidance: {
    sv: 'Miljöskydd, inom ansvaret för tillsynsvägledning.',
    en: 'Environmental protection, within the responsibility for supervisory guidance.',
  },
  finance: {
    sv: 'Finansiella tjänster, produkter och marknader samt förhindrande av penningtvätt och finansiering av terrorism.',
    en: 'Financial services, products and markets, and prevention of money laundering and terrorist financing.',
  },
  consumer: {
    sv: 'Konsumentskydd.',
    en: 'Consumer protection.',
  },
  privacy: {
    sv: 'Skydd av privatlivet och personuppgifter samt säkerhet i nätverks- och informationssystem.',
    en: 'Protection of privacy and personal data, and security of network and information systems.',
  },
  publicHealth: {
    sv: 'Folkhälsa.',
    en: 'Public health.',
  },
  radiation: {
    sv: 'Strålskydd och kärnsäkerhet.',
    en: 'Radiation protection and nuclear safety.',
  },
  food: {
    sv: 'Livsmedels- och fodersäkerhet samt djurs hälsa och välbefinnande.',
    en: 'Food and feed safety, and animal health and welfare.',
  },
  transport: {
    sv: 'Transportsäkerhet.',
    en: 'Transport safety.',
  },
  procurement: {
    sv: 'Offentlig upphandling.',
    en: 'Public procurement.',
  },
  catchAll: {
    sv: 'Missförhållanden som inte omfattas av någon annan behörig myndighets ansvarsområde.',
    en: 'Misconduct not covered by any other competent authority.',
  },
  euFraud: {
    sv: 'EU:s finansiella intressen, när det gäller bedrägeribekämpning.',
    en: "The EU's financial interests, as regards combating fraud.",
  },
  euStateAid: {
    sv: 'EU:s finansiella intressen och den inre marknaden, när det gäller statsstöd.',
    en: "The EU's financial interests and the internal market, as regards state aid.",
  },
  euTax: {
    sv: 'EU:s finansiella intressen när det gäller skatteområdet, och den inre marknaden när det gäller bolagsskatt.',
    en: "The EU's financial interests as regards taxation, and the internal market as regards corporate tax.",
  },
  countyExtra: {
    sv: 'Länsstyrelserna i Stockholms, Västra Götalands och Skåne län ansvarar även för finansiella tjänster, produkter och marknader samt förhindrande av penningtvätt och finansiering av terrorism.',
    en: 'The county administrative boards of Stockholm, Västra Götaland and Skåne are also responsible for financial services, products and markets, and prevention of money laundering and terrorist financing.',
  },
};

// Svenska myndigheter. Områdena gäller det som omfattas av respektive
// myndighets tillsynsansvar.
const EXTERNAL_AUTHORITIES = [
  { name: 'Arbetsmiljöverket', areas: ['productSafety', 'catchAll'], url: 'https://www.av.se/om-oss/visselblasarlagen/extern-rapporteringskanal/', logo: 'images/logos/arbetsmiljoverket.png' },
  { name: 'Boverket', areas: ['productSafety'], url: 'https://www.boverket.se/sv/om-boverket/kontakta-oss/visselblasning/', logo: 'images/logos/boverket.webp' },
  { name: 'Ekobrottsmyndigheten', areas: ['euFraud'], url: 'https://www.ekobrottsmyndigheten.se/kontakta-oss/visselblasarfunktion/', logo: 'images/logos/ekobrottsmyndigheten.png' },
  { name: 'Elsäkerhetsverket', areas: ['productSafety'], url: 'https://www.elsakerhetsverket.se/yrkespersoner/tillverka-och-salja-elprodukter/sla-larm-om-missforhallanden/', logo: 'images/logos/elsakerhetsverket.svg' },
  { name: 'Fastighetsmäklarinspektionen', areas: ['finance'], url: 'https://fmi.se/det-har-ar-fmi/kontakta-oss/visselblasning-om-penningtvatt-eller-finansiering-av-terrorism/', logo: 'images/logos/fastighetsmaklarinspektionen.webp' },
  { name: 'Finansinspektionen', areas: ['finance', 'consumer', 'privacy'], url: 'https://www.fi.se/sv/om-fi/kontakta-oss/visselblasare/', logo: 'images/logos/finansinspektionen.svg' },
  { name: 'Folkhälsomyndigheten', areas: ['productSafety', 'publicHealth'], url: 'https://www.folkhalsomyndigheten.se/om-folkhalsomyndigheten/kontakta-folkhalsomyndigheten/visselblasning/', logo: 'images/logos/folkhalsomyndigheten.svg' },
  { name: 'Havs- och vattenmyndigheten', areas: ['environment'], url: 'https://www.havochvatten.se/om-oss-kontakt-och-karriar/om-oss/visselblasarfunktion.html', logo: 'images/logos/havs-och-vattenmyndigheten.png' },
  { name: 'Inspektionen för strategiska produkter', areas: ['productSafety'], url: 'https://www.isp.se/om-isp/visselblasning-till-isp/', logo: 'images/logos/inspektionen-for-strategiska-produkter.svg' },
  { name: 'Inspektionen för vård och omsorg', areas: ['publicHealth', 'privacy'], url: 'https://ivo.se/visselblas', logo: 'images/logos/inspektionen-for-vard-och-omsorg.webp' },
  { name: 'Integritetsskyddsmyndigheten', areas: ['privacy'], url: 'https://www.imy.se/privatperson/utfora-arenden/visselblasning/', logo: 'images/logos/integritetsskyddsmyndigheten.png' },
  { name: 'Kemikalieinspektionen', areas: ['productSafety', 'environment'], url: 'https://www.kemi.se/om-kemikalieinspektionen/kontakta-oss/extern-kanal-for-visselblasning', logo: 'images/logos/kemikalieinspektionen.jpg' },
  { name: 'Konkurrensverket', areas: ['procurement'], url: 'https://www.konkurrensverket.se/tipsa-oss/visselblasarfunktion/', logo: 'images/logos/konkurrensverket.png' },
  { name: 'Konsumentverket', areas: ['productSafety', 'publicHealth', 'consumer'], url: 'https://www.konsumentverket.se/om-konsumentverket/var-verksamhet/visselblasning/extern-kanal-for-visselblasning/', logo: 'images/logos/konsumentverket.png' },
  { name: 'Livsmedelsverket', areas: ['productSafety', 'environment', 'radiation', 'food', 'privacy'], url: 'https://www.livsmedelsverket.se/om-oss/kontakt/visselblasning--rapportera-om-missforhallanden', logo: 'images/logos/livsmedelsverket.webp' },
  { name: 'Läkemedelsverket', areas: ['productSafety', 'publicHealth'], url: 'https://www.lakemedelsverket.se/sv/om-lakemedelsverket/kontakta-oss/visselblasning', logo: 'images/logos/lakemedelsverket.webp' },
  // Listan anger "Se aktuell länsstyrelses hemsida". Länsstyrelsernas
  // gemensamma webbplats leder vidare till varje län.
  { name: 'Länsstyrelserna', areas: ['productSafetyGuidance', 'environmentGuidance', 'countyExtra'], url: 'https://www.lansstyrelsen.se/', countyBoards: true },
  { name: 'Myndigheten för samhällsskydd och beredskap', areas: ['productSafety'], url: 'https://www.msb.se/sv/om-msb/kontakta-oss/visselblasning--rapportera--om-missforhallanden/', logo: 'images/logos/myndigheten-for-samhallsskydd-och-beredskap.webp' },
  { name: 'Naturvårdsverket', areas: ['productSafety', 'environment'], url: 'https://www.naturvardsverket.se/om-oss/kontakt/visselblasning/', logo: 'images/logos/naturvardsverket.png' },
  { name: 'Post- och telestyrelsen', areas: ['productSafety', 'privacy'], url: 'https://www.pts.se/om-oss/visselblasning/', logo: 'images/logos/post-och-telestyrelsen.png' },
  { name: 'Regeringskansliet', areas: ['euStateAid'], url: 'https://www.regeringen.se/om-webbplatsen/rapportera-missforhallanden-om-statsstod/', logo: 'images/logos/regeringskansliet.svg' },
  { name: 'Revisorsinspektionen', areas: ['finance'], url: 'https://www.revisorsinspektionen.se/tillsyn/rapportering-om-missforhallanden/', logo: 'images/logos/revisorsinspektionen.png' },
  { name: 'Skatteverket', areas: ['euTax'], url: 'https://www.skatteverket.se/omoss/varverksamhet/styrningochuppfoljning/skattekontroller/rapporteraommissforhallandeninomskatteomradet.4.1df9c71e181083ce6f636e5.html', logo: 'images/logos/skatteverket.png' },
  { name: 'Skogsstyrelsen', areas: ['environment'], url: 'https://www.skogsstyrelsen.se/kontakt/visselblasning/', logo: 'images/logos/skogsstyrelsen.png' },
  { name: 'Spelinspektionen', areas: ['finance'], url: 'https://www.spelinspektionen.se/lagar-regler/penningtvatt/visselblasarfunktion/' },
  { name: 'Statens energimyndighet', areas: ['productSafety', 'privacy'], url: 'https://www.energimyndigheten.se/om-oss/anmal-misstankar-om-korruption-och-oegentligheter/', logo: 'images/logos/statens-energimyndighet.webp' },
  { name: 'Statens jordbruksverk', areas: ['environment', 'food', 'productSafety'], url: 'https://jordbruksverket.se/om-jordbruksverket/visselblasning', logo: 'images/logos/statens-jordbruksverk.png' },
  { name: 'Strålsäkerhetsmyndigheten', areas: ['productSafety'], url: 'https://www.stralsakerhetsmyndigheten.se/kontakt/visselblasarfunktion/', logo: 'images/logos/stralsakerhetsmyndigheten.jpg' },
  { name: 'Styrelsen för ackreditering och teknisk kontroll', areas: ['productSafety'], url: 'https://www.swedac.se/visselblasning/', logo: 'images/logos/styrelsen-for-ackreditering-och-teknisk-kontroll.svg' },
  { name: 'Transportstyrelsen', areas: ['productSafety', 'transport', 'privacy'], url: 'https://www.transportstyrelsen.se/sv/Om-transportstyrelsen/visselblasning/', logo: 'images/logos/transportstyrelsen.jpg' },
];

const EXTERNAL_EU = [
  {
    name: 'OLAF – Europeiska byrån för bedrägeribekämpning',
    text: {
      sv: 'Bedrägerier eller andra allvarliga oegentligheter som kan påverka EU-medel negativt, samt allvarliga tjänstefel av ledamöter eller anställda vid EU:s institutioner och byråer.',
      en: 'Fraud or other serious irregularities that may harm EU funds, and serious misconduct by members or staff of EU institutions and bodies.',
    },
    url: 'https://anti-fraud.ec.europa.eu/olaf-and-you/report-fraud_sv',
    logo: 'images/logos/olaf-europeiska-byran-for-bedrageribekampning.svg',
  },
  {
    name: 'ESMA – Europeiska värdepappers- och marknadsmyndigheten',
    text: {
      sv: 'Överträdelser av EU-lagstiftning hos företag som ESMA övervakar direkt, hot mot finanssystemets stabilitet eller konsumentskyddet, samt misstänkt olaglig verksamhet inom ESMA.',
      en: 'Breaches of EU law by entities directly supervised by ESMA, threats to financial stability or consumer protection, and suspected illegal activity within ESMA.',
    },
    url: 'https://www.esma.europa.eu/about-esma/whistleblowers',
    logo: 'images/logos/esma-europeiska-vardepappers-och-marknadsmyndigh.svg',
  },
  {
    name: 'EASA – Europeiska byrån för luftfartssäkerhet',
    text: {
      sv: 'Misstänkta överträdelser av EU:s regler för civil luftfartssäkerhet, inklusive olagliga handlingar eller försummelser inom EASA:s område.',
      en: "Suspected breaches of EU civil aviation safety rules, including illegal acts or omissions within EASA's remit.",
    },
    url: 'https://www.easa.europa.eu/en/confidential-safety-reporting',
    logo: 'images/logos/easa-europeiska-byran-for-luftfartssakerhet.png',
  },
  {
    name: 'EMA – Europeiska läkemedelsmyndigheten',
    text: {
      sv: 'Överträdelser inom EMA:s ansvarsområde, till exempel brister i god praxis som kan påverka utvärdering och tillsyn av human- och veterinärmedicinska läkemedel.',
      en: "Breaches within EMA's remit, for example failures to follow good practice that may affect the evaluation and supervision of human and veterinary medicines.",
    },
    url: 'https://www.ema.europa.eu/en/about-us/how-we-work/external-whistleblowing-policy',
  },
];

// Kort med namn, logotyp, områden och länk. Allt byggs med textContent:
// inget här ska tolkas som HTML.
//
// Logotyperna ligger i images/logos/ i stället för att hämtas från
// myndigheternas egna servrar. Annars hade varje myndighet sett varje
// besök på sidan, och på en visselblåsarsajt ska ingen utomstående
// kunna se vem som tittar på externa rapporteringskanaler.
function externalCard(name, text, url, linkKey, logo) {
  const card = el('div', 'external-card');
  const head = el('div', 'external-card-head');
  const h = el('h3');
  h.textContent = name;
  head.appendChild(h);
  if (logo) {
    const img = el('img', 'external-logo');
    img.src = logo;
    img.alt = '';
    img.loading = 'lazy';
    // En trasig bild ska inte lämna en tom ruta efter sig.
    img.addEventListener('error', () => img.remove());
    head.appendChild(img);
  }
  const p = el('p');
  p.textContent = text;
  const a = el('a', 'external-link');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = t(linkKey);
  const icon = el('i', 'ti ti-external-link');
  icon.setAttribute('aria-hidden', 'true');
  a.appendChild(icon);
  card.append(head, p, a);
  return card;
}

function renderExternalChannels() {
  const authoritiesEl = document.getElementById('external-authorities');
  const euEl = document.getElementById('external-eu');
  const emptyEl = document.getElementById('external-empty');
  if (!authoritiesEl || !euEl) return;

  const lang = currentLang === 'en' ? 'en' : 'sv';
  const query = (document.getElementById('external-search').value || '').trim().toLowerCase();
  const matches = (name, text) => !query || (name + ' ' + text).toLowerCase().includes(query);

  authoritiesEl.innerHTML = '';
  let shown = 0;
  EXTERNAL_AUTHORITIES.forEach(a => {
    const text = a.areas.map(k => EXTERNAL_AREAS[k][lang]).join(' ');
    if (!matches(a.name, text)) return;
    authoritiesEl.appendChild(externalCard(a.name, text, a.url, a.countyBoards ? 'external.countyLink' : 'external.link', a.logo));
    shown++;
  });

  euEl.innerHTML = '';
  let shownEu = 0;
  EXTERNAL_EU.forEach(a => {
    if (!matches(a.name, a.text[lang])) return;
    euEl.appendChild(externalCard(a.name, a.text[lang], a.url, 'external.link', a.logo));
    shownEu++;
  });

  document.getElementById('external-authorities-section').style.display = shown ? 'block' : 'none';
  document.getElementById('external-eu-section').style.display = shownEu ? 'block' : 'none';
  emptyEl.style.display = shown || shownEu ? 'none' : 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('external-search');
  if (search) search.addEventListener('input', renderExternalChannels);
  renderExternalChannels();
});
