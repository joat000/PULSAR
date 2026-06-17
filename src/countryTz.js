// Country name → IANA timezone(s) mapping
// Covers all UN-recognised countries + common territories and aliases
export const COUNTRY_TZ = {
  "afghanistan": ["Asia/Kabul"],
  "albania": ["Europe/Tirane"],
  "algeria": ["Africa/Algiers"],
  "andorra": ["Europe/Andorra"],
  "angola": ["Africa/Luanda"],
  "antigua and barbuda": ["America/Antigua"],
  "argentina": ["America/Argentina/Buenos_Aires","America/Argentina/Cordoba","America/Argentina/Salta","America/Argentina/Jujuy","America/Argentina/Tucuman","America/Argentina/Catamarca","America/Argentina/La_Rioja","America/Argentina/San_Juan","America/Argentina/Mendoza","America/Argentina/San_Luis","America/Argentina/Rio_Gallegos","America/Argentina/Ushuaia"],
  "armenia": ["Asia/Yerevan"],
  "australia": ["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth","Australia/Adelaide","Australia/Hobart","Australia/Darwin","Australia/Lord_Howe"],
  "austria": ["Europe/Vienna"],
  "azerbaijan": ["Asia/Baku"],
  "bahamas": ["America/Nassau"],
  "bahrain": ["Asia/Bahrain"],
  "bangladesh": ["Asia/Dhaka"],
  "barbados": ["America/Barbados"],
  "belarus": ["Europe/Minsk"],
  "belgium": ["Europe/Brussels"],
  "belize": ["America/Belize"],
  "benin": ["Africa/Porto-Novo"],
  "bhutan": ["Asia/Thimphu"],
  "bolivia": ["America/La_Paz"],
  "bosnia and herzegovina": ["Europe/Sarajevo"],
  "botswana": ["Africa/Gaborone"],
  "brazil": ["America/Sao_Paulo","America/Manaus","America/Belem","America/Fortaleza","America/Recife","America/Maceio","America/Bahia","America/Cuiaba","America/Campo_Grande","America/Porto_Velho","America/Boa_Vista","America/Rio_Branco","America/Noronha","America/Santarem"],
  "brunei": ["Asia/Brunei"],
  "bulgaria": ["Europe/Sofia"],
  "burkina faso": ["Africa/Ouagadougou"],
  "burundi": ["Africa/Bujumbura"],
  "cabo verde": ["Atlantic/Cape_Verde"],
  "cambodia": ["Asia/Phnom_Penh"],
  "cameroon": ["Africa/Douala"],
  "canada": ["America/Toronto","America/Vancouver","America/Calgary","America/Winnipeg","America/Halifax","America/St_Johns","America/Regina","America/Edmonton","America/Moncton","America/Whitehorse","America/Yellowknife","America/Iqaluit","America/Glace_Bay","America/Goose_Bay","America/Swift_Current","America/Creston","America/Dawson","America/Dawson_Creek","America/Fort_Nelson","America/Pangnirtung","America/Rankin_Inlet","America/Resolute","America/Cambridge_Bay"],
  "central african republic": ["Africa/Bangui"],
  "chad": ["Africa/Ndjamena"],
  "chile": ["America/Santiago","Pacific/Easter"],
  "china": ["Asia/Shanghai","Asia/Urumqi"],
  "colombia": ["America/Bogota"],
  "comoros": ["Indian/Comoro"],
  "congo": ["Africa/Brazzaville"],
  "democratic republic of the congo": ["Africa/Kinshasa","Africa/Lubumbashi"],
  "drc": ["Africa/Kinshasa","Africa/Lubumbashi"],
  "costa rica": ["America/Costa_Rica"],
  "croatia": ["Europe/Zagreb"],
  "cuba": ["America/Havana"],
  "cyprus": ["Asia/Nicosia","Asia/Famagusta"],
  "czech republic": ["Europe/Prague"],
  "czechia": ["Europe/Prague"],
  "denmark": ["Europe/Copenhagen"],
  "djibouti": ["Africa/Djibouti"],
  "dominica": ["America/Dominica"],
  "dominican republic": ["America/Santo_Domingo"],
  "ecuador": ["America/Guayaquil","Pacific/Galapagos"],
  "egypt": ["Africa/Cairo"],
  "el salvador": ["America/El_Salvador"],
  "equatorial guinea": ["Africa/Malabo"],
  "eritrea": ["Africa/Asmara"],
  "estonia": ["Europe/Tallinn"],
  "eswatini": ["Africa/Mbabane"],
  "ethiopia": ["Africa/Addis_Ababa"],
  "fiji": ["Pacific/Fiji"],
  "finland": ["Europe/Helsinki"],
  "france": ["Europe/Paris"],
  "gabon": ["Africa/Libreville"],
  "gambia": ["Africa/Banjul"],
  "georgia": ["Asia/Tbilisi"],
  "germany": ["Europe/Berlin","Europe/Busingen"],
  "ghana": ["Africa/Accra"],
  "greece": ["Europe/Athens"],
  "grenada": ["America/Grenada"],
  "guatemala": ["America/Guatemala"],
  "guinea": ["Africa/Conakry"],
  "guinea-bissau": ["Africa/Bissau"],
  "guyana": ["America/Guyana"],
  "haiti": ["America/Port-au-Prince"],
  "honduras": ["America/Tegucigalpa"],
  "hungary": ["Europe/Budapest"],
  "iceland": ["Atlantic/Reykjavik"],
  "india": ["Asia/Kolkata"],
  "indonesia": ["Asia/Jakarta","Asia/Makassar","Asia/Jayapura","Asia/Pontianak"],
  "iran": ["Asia/Tehran"],
  "iraq": ["Asia/Baghdad"],
  "ireland": ["Europe/Dublin"],
  "israel": ["Asia/Jerusalem"],
  "italy": ["Europe/Rome"],
  "ivory coast": ["Africa/Abidjan"],
  "jamaica": ["America/Jamaica"],
  "japan": ["Asia/Tokyo"],
  "jordan": ["Asia/Amman"],
  "kazakhstan": ["Asia/Almaty","Asia/Aqtau","Asia/Aqtobe","Asia/Atyrau","Asia/Oral","Asia/Qostanay","Asia/Qyzylorda"],
  "kenya": ["Africa/Nairobi"],
  "kiribati": ["Pacific/Tarawa","Pacific/Kanton","Pacific/Kiritimati"],
  "kuwait": ["Asia/Kuwait"],
  "kyrgyzstan": ["Asia/Bishkek"],
  "laos": ["Asia/Vientiane"],
  "latvia": ["Europe/Riga"],
  "lebanon": ["Asia/Beirut"],
  "lesotho": ["Africa/Maseru"],
  "liberia": ["Africa/Monrovia"],
  "libya": ["Africa/Tripoli"],
  "liechtenstein": ["Europe/Vaduz"],
  "lithuania": ["Europe/Vilnius"],
  "luxembourg": ["Europe/Luxembourg"],
  "madagascar": ["Indian/Antananarivo"],
  "malawi": ["Africa/Blantyre"],
  "malaysia": ["Asia/Kuala_Lumpur","Asia/Kuching"],
  "maldives": ["Indian/Maldives"],
  "mali": ["Africa/Bamako"],
  "malta": ["Europe/Malta"],
  "marshall islands": ["Pacific/Majuro","Pacific/Kwajalein"],
  "mauritania": ["Africa/Nouakchott"],
  "mauritius": ["Indian/Mauritius"],
  "mexico": ["America/Mexico_City","America/Cancun","America/Merida","America/Monterrey","America/Matamoros","America/Chihuahua","America/Ciudad_Juarez","America/Ojinaga","America/Mazatlan","America/Hermosillo","America/Tijuana","America/Ensenada","America/Bahia_Banderas"],
  "micronesia": ["Pacific/Pohnpei","Pacific/Chuuk","Pacific/Kosrae"],
  "moldova": ["Europe/Chisinau"],
  "monaco": ["Europe/Monaco"],
  "mongolia": ["Asia/Ulaanbaatar","Asia/Hovd","Asia/Choibalsan"],
  "montenegro": ["Europe/Podgorica"],
  "morocco": ["Africa/Casablanca","Africa/El_Aaiun"],
  "mozambique": ["Africa/Maputo"],
  "myanmar": ["Asia/Rangoon"],
  "namibia": ["Africa/Windhoek"],
  "nauru": ["Pacific/Nauru"],
  "nepal": ["Asia/Kathmandu"],
  "netherlands": ["Europe/Amsterdam"],
  "new zealand": ["Pacific/Auckland","Pacific/Chatham"],
  "nicaragua": ["America/Managua"],
  "niger": ["Africa/Niamey"],
  "nigeria": ["Africa/Lagos"],
  "north korea": ["Asia/Pyongyang"],
  "north macedonia": ["Europe/Skopje"],
  "norway": ["Europe/Oslo"],
  "oman": ["Asia/Muscat"],
  "pakistan": ["Asia/Karachi"],
  "palau": ["Pacific/Palau"],
  "palestine": ["Asia/Gaza","Asia/Hebron"],
  "panama": ["America/Panama"],
  "papua new guinea": ["Pacific/Port_Moresby","Pacific/Bougainville"],
  "paraguay": ["America/Asuncion"],
  "peru": ["America/Lima"],
  "philippines": ["Asia/Manila"],
  "poland": ["Europe/Warsaw"],
  "portugal": ["Europe/Lisbon","Atlantic/Azores","Atlantic/Madeira"],
  "qatar": ["Asia/Qatar"],
  "romania": ["Europe/Bucharest"],
  "russia": ["Europe/Moscow","Europe/Kaliningrad","Europe/Samara","Europe/Saratov","Europe/Ulyanovsk","Europe/Volgograd","Asia/Yekaterinburg","Asia/Omsk","Asia/Novosibirsk","Asia/Barnaul","Asia/Tomsk","Asia/Novokuznetsk","Asia/Krasnoyarsk","Asia/Irkutsk","Asia/Chita","Asia/Yakutsk","Asia/Khandyga","Asia/Vladivostok","Asia/Ust-Nera","Asia/Magadan","Asia/Sakhalin","Asia/Srednekolymsk","Asia/Kamchatka","Asia/Anadyr"],
  "rwanda": ["Africa/Kigali"],
  "saint kitts and nevis": ["America/St_Kitts"],
  "saint lucia": ["America/St_Lucia"],
  "saint vincent and the grenadines": ["America/St_Vincent"],
  "samoa": ["Pacific/Apia"],
  "san marino": ["Europe/San_Marino"],
  "sao tome and principe": ["Africa/Sao_Tome"],
  "saudi arabia": ["Asia/Riyadh"],
  "senegal": ["Africa/Dakar"],
  "serbia": ["Europe/Belgrade"],
  "seychelles": ["Indian/Mahe"],
  "sierra leone": ["Africa/Freetown"],
  "singapore": ["Asia/Singapore"],
  "slovakia": ["Europe/Bratislava"],
  "slovenia": ["Europe/Ljubljana"],
  "solomon islands": ["Pacific/Guadalcanal"],
  "somalia": ["Africa/Mogadishu"],
  "south africa": ["Africa/Johannesburg"],
  "south korea": ["Asia/Seoul"],
  "korea": ["Asia/Seoul"],
  "south sudan": ["Africa/Juba"],
  "spain": ["Europe/Madrid","Africa/Ceuta","Atlantic/Canary"],
  "sri lanka": ["Asia/Colombo"],
  "sudan": ["Africa/Khartoum"],
  "suriname": ["America/Paramaribo"],
  "sweden": ["Europe/Stockholm"],
  "switzerland": ["Europe/Zurich"],
  "syria": ["Asia/Damascus"],
  "taiwan": ["Asia/Taipei"],
  "tajikistan": ["Asia/Dushanbe"],
  "tanzania": ["Africa/Dar_es_Salaam"],
  "thailand": ["Asia/Bangkok"],
  "timor-leste": ["Asia/Dili"],
  "togo": ["Africa/Lome"],
  "tonga": ["Pacific/Tongatapu"],
  "trinidad and tobago": ["America/Port_of_Spain"],
  "tunisia": ["Africa/Tunis"],
  "turkey": ["Europe/Istanbul"],
  "turkmenistan": ["Asia/Ashgabat"],
  "tuvalu": ["Pacific/Funafuti"],
  "uganda": ["Africa/Kampala"],
  "ukraine": ["Europe/Kyiv","Europe/Uzhgorod","Europe/Zaporozhye"],
  "united arab emirates": ["Asia/Dubai"],
  "uae": ["Asia/Dubai"],
  "united kingdom": ["Europe/London"],
  "uk": ["Europe/London"],
  "england": ["Europe/London"],
  "scotland": ["Europe/London"],
  "wales": ["Europe/London"],
  "united states": ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu","America/Detroit","America/Indiana/Indianapolis","America/Indiana/Knox","America/Indiana/Marengo","America/Indiana/Petersburg","America/Indiana/Tell_City","America/Indiana/Vevay","America/Indiana/Vincennes","America/Indiana/Winamac","America/Kentucky/Louisville","America/Kentucky/Monticello","America/North_Dakota/Beulah","America/North_Dakota/Center","America/North_Dakota/New_Salem","America/Boise","America/Juneau","America/Metlakatla","America/Nome","America/Sitka","America/Yakutat","America/Adak"],
  "usa": ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu"],
  "us": ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu"],
  "america": ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu"],
  "uruguay": ["America/Montevideo"],
  "uzbekistan": ["Asia/Tashkent","Asia/Samarkand"],
  "vanuatu": ["Pacific/Efate"],
  "vatican": ["Europe/Vatican"],
  "venezuela": ["America/Caracas"],
  "vietnam": ["Asia/Ho_Chi_Minh"],
  "yemen": ["Asia/Aden"],
  "zambia": ["Africa/Lusaka"],
  "zimbabwe": ["Africa/Harare"],
  // Common territories & regions
  "hong kong": ["Asia/Hong_Kong"],
  "macau": ["Asia/Macau"],
  "macao": ["Asia/Macau"],
  "puerto rico": ["America/Puerto_Rico"],
  "guam": ["Pacific/Guam"],
  "greenland": ["America/Nuuk","America/Scoresbysund","America/Thule"],
  "french polynesia": ["Pacific/Tahiti","Pacific/Marquesas","Pacific/Gambier"],
  "new caledonia": ["Pacific/Noumea"],
  "reunion": ["Indian/Reunion"],
  "mayotte": ["Indian/Mayotte"],
  "guadeloupe": ["America/Guadeloupe"],
  "martinique": ["America/Martinique"],
  "french guiana": ["America/Cayenne"],
  "azores": ["Atlantic/Azores"],
  "canary islands": ["Atlantic/Canary"],
  "bermuda": ["Atlantic/Bermuda"],
  "cayman islands": ["America/Cayman"],
  "turks and caicos": ["America/Grand_Turk"],
  "british virgin islands": ["America/Tortola"],
  "us virgin islands": ["America/St_Thomas"],
  "aruba": ["America/Aruba"],
  "curacao": ["America/Curacao"],
};

// Build a reverse lookup: tz → [country names]
const TZ_TO_COUNTRIES = {};
for (const [country, zones] of Object.entries(COUNTRY_TZ)) {
  for (const z of zones) {
    if (!TZ_TO_COUNTRIES[z]) TZ_TO_COUNTRIES[z] = [];
    TZ_TO_COUNTRIES[z].push(country);
  }
}

const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());

// Search timezones by country name first, falling back to tz name.
// Returns array of { tz, label, country } objects.
export function searchTz(allTz, query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return allTz.map(z => ({ tz: z, label: tzLabel(z), country: null }));
  }

  // 1. Exact country prefix matches (e.g. "ind" matches "india")
  const exactMatches = [];
  const partialMatches = [];

  for (const [country, zones] of Object.entries(COUNTRY_TZ)) {
    if (country === q || country.startsWith(q)) {
      zones.forEach(z => exactMatches.push({ tz: z, label: tzLabelForCountry(z, country), country }));
    } else if (country.includes(q)) {
      zones.forEach(z => partialMatches.push({ tz: z, label: tzLabelForCountry(z, country), country }));
    }
  }

  // Deduplicate by tz (a zone may appear under multiple country aliases)
  const seen = new Set();
  const countryResults = [];
  for (const item of [...exactMatches, ...partialMatches]) {
    if (!seen.has(item.tz)) { seen.add(item.tz); countryResults.push(item); }
  }

  // If we found country matches, return only those
  if (countryResults.length > 0) return countryResults;

  // 2. Fall back to raw tz name substring match
  return allTz
    .filter(z => z.toLowerCase().includes(q))
    .map(z => ({ tz: z, label: tzLabel(z), country: null }));
}

function tzLabelForCountry(z, country) {
  const city = z.split("/").pop().replace(/_/g, " ");
  const countryName = cap(country);
  // For countries with one zone just show the country name
  const zones = COUNTRY_TZ[country] ?? [];
  if (zones.length === 1) return countryName;
  return `${city} — ${countryName}`;
}

// Get a display label for a timezone showing the country if known
export function tzLabel(z) {
  const countries = TZ_TO_COUNTRIES[z];
  const city = z.split("/").pop().replace(/_/g, " ");
  if (countries?.length) {
    const name = cap(countries[0]);
    const zones = COUNTRY_TZ[countries[0]] ?? [];
    if (zones.length === 1) return name;
    return `${city} — ${name}`;
  }
  return z.replace(/_/g, " ");
}
