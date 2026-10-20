# Lafayette, CA — research brief for the open-world game
Compiled 2026-10-19 (PT). Companion files: `pois.geojson` (93 points), `data_sources.csv`. Every fact carries a source, and anything I couldn't source is marked **UNKNOWN** or **GAP**. Private residences and private individuals are excluded.

## 1. Data sources
**City bbox (OSM relation 3705570, via Nominatim):** S 37.8492664, N 37.9393637, W -122.1652163, E -122.0779872. Centre 37.8857582,-122.1180201. Source: https://nominatim.openstreetmap.org/search?city=Lafayette&state=California&format=json

See `data_sources.csv` for licenses and endpoints. Key points:
- **Buildings:** OSM (ODbL). Microsoft footprints (ODbL, https://github.com/microsoft/GlobalMLBuildingFootprints). Overture (https://docs.overturemaps.org/), which has a per-feature license. Few OSM downtown buildings carry `height` or `building:colour`; none of the 99 named downtown features I pulled had colour or material tags. County data: Contra Costa GIS (https://gis.cccounty.us/), license not verified (**GAP**).
- **Terrain:** USGS 3DEP 1 m DEM, public domain. The TNM API for bbox -122.16,37.86,-122.07,37.92 returns project **CA_NoCAL_Wildfires_B5b_2018** tiles **x57y420** and **x58y420**, plus **CA_AlamedaCounty_2021_B21** tile x57y420 (URLs in the CSV). Source: https://tnmaccess.nationalmap.gov/api/v1/products
- **Canopy:** NLCD/USFS canopy (public domain), Meta/WRI 1 m canopy height (CC BY 4.0, https://registry.opendata.aws/dataforgood-fb-forests/), CAL FIRE urban canopy (license **GAP**).
- **Roads/trails:** OSM. The Lafayette-Moraga Regional Trail is EBRPD's (https://www.ebparks.org/trails/interpark/lafayette-moraga). Reservoir trails in OSM include the Rim Trail, Sunset, Big Oak, Campolindo, Westview and Canyon trails (OSM map API, bbox -122.150,37.874,-122.130,37.892). Briones (OSM relation 10895202) and Acalanes Ridge (relation 6518527) are also in OSM.
- **Imagery:** NAIP and USGS orthos are public domain. Mapillary is CC BY-SA 4.0. **Google imagery/Street View can't be used** (https://www.google.com/help/terms_maps/).
- Technical note: the Overpass API timed out from the box, so POIs came from `api.openstreetmap.org/api/0.6/map`, the downtown bbox -122.130,37.884,-122.105,37.897.

## 2. Downtown businesses (OSM, 68 entries)
Storefront colour, signage and materials are **unknown** for all of them because OSM has no tags and I found no public description. Use NAIP or Mapillary for visual reference. OSM data changes and some entries may be stale (e.g. "BMO", "Citibank"), so verify before modelling.

| Name | Category | Address (OSM) | Lat | Lon | Source |
|---|---|---|---|---|---|
| The Final Stretch | therapist | 3658 Mount Diablo Boulevard | 37.891146 | -122.127668 | https://www.openstreetmap.org/node/13598734701 |
| Oyama Sushi | restaurant | — | 37.890664 | -122.127568 | https://www.openstreetmap.org/node/12878460164 |
| Pho Benny | restaurant | — | 37.890479 | -122.127551 | https://www.openstreetmap.org/node/12878460163 |
| Trader Joe's | shop | 3649 Mount Diablo Boulevard | 37.890245 | -122.126948 | https://www.openstreetmap.org/way/508544694 |
| Kabab Burger Mediterranean Grill | restaurant | — | 37.890390 | -122.126746 | https://www.openstreetmap.org/node/12878460162 |
| Reasonable Books | shop | — | 37.890402 | -122.126592 | https://www.openstreetmap.org/node/12878460169 |
| The Rising Loafer | restaurant | — | 37.890438 | -122.126378 | https://www.openstreetmap.org/node/12878460170 |
| Chevron | fuel | — | 37.891280 | -122.126095 | https://www.openstreetmap.org/node/12878460165 |
| Round Table Pizza | restaurant | — | 37.890676 | -122.125879 | https://www.openstreetmap.org/node/12878460160 |
| Wells Fargo | bank | — | 37.891468 | -122.125366 | https://www.openstreetmap.org/node/12878460167 |
| Johnny's Donut Shop | fast_food | — | 37.890760 | -122.125342 | https://www.openstreetmap.org/node/12878460168 |
| CVS Pharmacy | shop | — | 37.890764 | -122.125083 | https://www.openstreetmap.org/node/12878460159 |
| Diablo Foods | shop | — | 37.890762 | -122.124601 | https://www.openstreetmap.org/node/12878460158 |
| Pet Food Express | shop | — | 37.891616 | -122.124023 | https://www.openstreetmap.org/way/992609533 |
| Chase | bank | — | 37.891137 | -122.124008 | https://www.openstreetmap.org/node/12878460157 |
| Panda Express | fast_food | 3608 Mount Diablo Boulevard | 37.891589 | -122.123618 | https://www.openstreetmap.org/node/12878460148 |
| Batch and Brine | restaurant | — | 37.891612 | -122.123437 | https://www.openstreetmap.org/node/12878460149 |
| Philz Coffee | cafe | — | 37.891234 | -122.123392 | https://www.openstreetmap.org/node/12878460147 |
| Pizza Antica | restaurant | 3600 Mount Diablo Boulevard | 37.891745 | -122.123219 | https://www.openstreetmap.org/way/471338256 |
| SusieCakes | shop | 3598 Mount Diablo Boulevard | 37.891640 | -122.123063 | https://www.openstreetmap.org/node/12878460150 |
| Social Bird | restaurant | 3593 Mount Diablo Boulevard | 37.891244 | -122.123047 | https://www.openstreetmap.org/node/4655014307 |
| Barranco Cocina Peruana | restaurant | — | 37.891701 | -122.122921 | https://www.openstreetmap.org/node/12878460151 |
| Women's Health Center: Sutter Alta Bates Summit Medical Center | health | 3595 Mount Diablo Boulevard | 37.891155 | -122.122902 | https://www.openstreetmap.org/node/4655014309 |
| Misto Lino | shop | 3585 Mount Diablo Boulevard | 37.891159 | -122.122711 | https://www.openstreetmap.org/node/4655014308 |
| Caveman Food LLC | yes | 3595 Mount Diablo Boulevard | 37.891289 | -122.122687 | https://www.openstreetmap.org/node/4655014310 |
| Kiku Sushi and Vegetarian | restaurant | — | 37.890809 | -122.122588 | https://www.openstreetmap.org/node/12878460144 |
| AT&T | shop | 3592 Mount Diablo Boulevard | 37.891838 | -122.122523 | https://www.openstreetmap.org/node/4655014150 |
| BevMo! | shop | 3590 Mount Diablo Boulevard | 37.891729 | -122.122443 | https://www.openstreetmap.org/node/4655014151 |
| Ensor Jeremy E OD | shop | 284 Lafayette Circle | 37.890873 | -122.122305 | https://www.openstreetmap.org/node/12878460145 |
| BMO | bank | — | 37.891383 | -122.122192 | https://www.openstreetmap.org/node/12878460146 |
| Supercuts | shop | 3586 Mount Diablo Boulevard | 37.891794 | -122.122109 | https://www.openstreetmap.org/node/4655014143 |
| Luxe Home by Douglah Designs | shop | 3535 Mount Diablo Boulevard | 37.891849 | -122.121993 | https://www.openstreetmap.org/node/4655014142 |
| Floral Arts Florist | shop | 3584 Mount Diablo Boulevard | 37.891924 | -122.121842 | https://www.openstreetmap.org/way/471338251 |
| The Breakfast Club at Midtown | restaurant | — | 37.891453 | -122.121834 | https://www.openstreetmap.org/node/12878460152 |
| One Hour Cleaners | shop | 3580 Mount Diablo Boulevard | 37.891904 | -122.121751 | https://www.openstreetmap.org/way/471338250 |
| Rustic Tavern | restaurant | 3576 Mount Diablo Boulevard | 37.892013 | -122.121277 | https://www.openstreetmap.org/way/471338249 |
| Postino | restaurant | — | 37.891354 | -122.121224 | https://www.openstreetmap.org/node/12878460154 |
| El Jarro Mexican Cafe | restaurant | — | 37.891553 | -122.121102 | https://www.openstreetmap.org/node/12878460153 |
| Learning Express Toys | shop | 3568 Mount Diablo Boulevard | 37.891961 | -122.120937 | https://www.openstreetmap.org/node/13461328224 |
| First Mile Cycle Works | shop | 3566 Mount Diablo Boulevard | 37.891970 | -122.120851 | https://www.openstreetmap.org/node/13461328225 |
| Uncle Yu's | restaurant | 999 Oak Hill Road | 37.892358 | -122.120767 | https://www.openstreetmap.org/way/471338247 |
| Amarin | restaurant | — | 37.891615 | -122.120673 | https://www.openstreetmap.org/node/12878460155 |
| Poke Go | fast_food | — | 37.891628 | -122.120607 | https://www.openstreetmap.org/node/12878460156 |
| Roundup Saloon | bar | — | 37.891624 | -122.120471 | https://www.openstreetmap.org/node/2667819035 |
| American Kitchen | restaurant | — | 37.890288 | -122.120339 | https://www.openstreetmap.org/node/4812924611 |
| Lafayette Public House | cafe | — | 37.890723 | -122.120318 | https://www.openstreetmap.org/node/4812924613 |
| Millie's | restaurant | — | 37.893172 | -122.120228 | https://www.openstreetmap.org/way/888519444 |
| The cooperage | restaurant | — | 37.891061 | -122.120202 | https://www.openstreetmap.org/node/4812925462 |
| Starbucks | cafe | 3547 A Mount Diablo Boulevard | 37.891691 | -122.120046 | https://www.openstreetmap.org/node/2952933377 |
| Roam Artisan Burgers | restaurant | — | 37.891493 | -122.120000 | https://www.openstreetmap.org/node/2952933378 |
| Tutu's | restaurant | 53 Lafayette Circle | 37.890719 | -122.119939 | https://www.openstreetmap.org/node/4812924612 |
| Solano Jewelers | shop | 61 Lafayette Circle | 37.890160 | -122.119731 | https://www.openstreetmap.org/node/6257089275 |
| Douglah Designs | shop | 985 Moraga Road | 37.891683 | -122.119512 | https://www.openstreetmap.org/node/14276190352 |
| Safeway | shop | 3540 Mount Diablo Boulevard | 37.892808 | -122.119416 | https://www.openstreetmap.org/way/154644945 |
| Local Food Adventures | restaurant | 6114 La Salle Avenue | 37.891712 | -122.119136 | https://www.openstreetmap.org/node/6165266922 |
| Bank of America | bank | — | 37.892507 | -122.118477 | https://www.openstreetmap.org/way/252728823 |
| Sideboard | restaurant | — | 37.891553 | -122.118238 | https://www.openstreetmap.org/node/9163549062 |
| Peet's Coffee | cafe | — | 37.893124 | -122.118012 | https://www.openstreetmap.org/node/9275203680 |
| Citibank | bank | — | 37.892421 | -122.117935 | https://www.openstreetmap.org/way/888519448 |
| 76 | fuel | — | 37.891945 | -122.117833 | https://www.openstreetmap.org/node/9163567607 |
| Metro | restaurant | — | 37.892494 | -122.117671 | https://www.openstreetmap.org/node/9275177463 |
| Jackson's | shop | — | 37.892455 | -122.117392 | https://www.openstreetmap.org/node/9275213200 |
| Whole Foods Market | shop | 3502 Mount Diablo Boulevard | 37.893591 | -122.117249 | https://www.openstreetmap.org/way/252728826 |
| Max Auto Center LLC | shop | — | 37.892703 | -122.116799 | https://www.openstreetmap.org/way/888519445 |
| Kane Sushi | restaurant | — | 37.892776 | -122.115288 | https://www.openstreetmap.org/way/272696196 |
| McDonald's | fast_food | 3459 Mount Diablo Boulevard | 37.892432 | -122.113981 | https://www.openstreetmap.org/way/597105276 |
| Horn Barbeque | restaurant | — | 37.893524 | -122.110952 | https://www.openstreetmap.org/node/13367876205 |
| Headlands Brewing Company | bar | — | 37.893540 | -122.110764 | https://www.openstreetmap.org/node/8883613216 |

## 3. Landmarks
### Park Theater
Streamline Moderne single-screen cinema opened Aug 21, 1941 (designed by William B. David); closed 2005; bought by the Park Theater Trust in Dec 2021; under renovation as a two-screen cinema, target reopening early 2027. Interior palette originally blues, ivory and maroon; 1941 neon marquee in storage at NeonWorks.  
*37.891799, -122.120802* (coords: US Census geocoder (address interpolation), confidence medium). Source: https://parktheatertrust.org/history/ ; https://lamorindaweekly.com/articles/2026/park-theater-renovation-plans-and-timeline-presented-to-city-council/

### Lafayette Library and Learning Center
Library opened Nov 14, 2009, designed by Killefer Flammang Architects as a 'contemporary Craftsman' stone-and-wood building stepping down from Mt Diablo Blvd to First St. Its atrium honors Nobel laureate Glenn Seaborg. Built on the site of the 1938-39 WPA Veterans Memorial Building.  
*37.891942, -122.115752* (coords: OSM way/326482972 centroid, confidence high). Source: https://www.sfgate.com/opinion/article/Library-success-story-in-Lafayette-3211232.php ; https://www.lovelafayette.org/home/showpublisheddocument/197/635561390008430000

### Lafayette Historical Society
Began 1967 as a committee of the Lafayette Library Association; incorporated as a nonprofit March 19, 1973. Located in the Library and Learning Center (location approximate).  
*37.891900, -122.115800* (coords: approximate: library building centroid, confidence low). Source: https://lafayettehistory.org/wp-content/uploads/2017/04/Newsletter-March-April-2017-2.pdf

### Lafayette Hillside Memorial (The Crosses of Lafayette)
Hillside of thousands of crosses and other symbols on Deer Hill Rd, visible from BART and Hwy 24, begun 2003 and in earnest Nov 11, 2006. The count sign was replaced with 'Remember' in 2022.  
*37.895013, -122.123311* (coords: OSM way/459217544 centroid, confidence high). Source: https://www.lafayettehillsidememorial.org/history.html

### Lafayette Reservoir
EBMUD reservoir. Dam built 1927-1933 after a 1928 slide forced a lower, wider redesign. Opened for recreation June 13, 1966, with a 2.7-mile paved loop.  
*37.880813, -122.142307* (coords: OSM way/27877916 centroid, confidence high). Source: https://lafayettehistory.org/wp-content/uploads/2024/01/Newsletter-April-2023.pdf ; https://www.ebmud.com/customers/pipeline/2016/05/50-years-reservoir-fun

### Lafayette Reservoir Outlet Tower
Dam outlet tower with valves and pipes to the filter plant. The original plan for a dam 33 ft taller was abandoned, so the tower stands well above the water.  
*37.884012, -122.140672* (coords: OSM node/2084054143, confidence high). Source: https://www.ebmud.com/about-us/construction-and-maintenance/construction-my-neighborhood/lafayettetower

### Lafayette Reservoir Visitor Center / boat rental
Visitor center and boat rental on the north shore.  
*37.883900, -122.142789* (coords: OSM way/348816503 centroid, confidence high). Source: https://www.openstreetmap.org/way/348816503

### Lafayette Reservoir Rim Trail
Rim trail circling the reservoir ridge. The centroid here is from a single OSM segment.  
*37.876197, -122.143842* (coords: OSM way centroid (segment), confidence medium). Source: https://www.openstreetmap.org/way/444096454

### Lafayette BART station
Opened May 21, 1973. One island platform in the Hwy 24 median.  
*37.893186, -122.124637* (coords: Nominatim OSM node/257088282, confidence high). Source: https://en.wikipedia.org/wiki/Lafayette_station_(BART)

### Veterans Memorial Center
New Veterans Memorial Center, dedicated May 30, 2005. It replaced the 1938-39 WPA building, whose site became the library.  
*37.888489, -122.134284* (coords: Nominatim OSM node/5889459287, confidence high). Source: https://livingnewdeal.org/sites/old-veterans-memorial-building-lafayette-ca/ ; https://www.westerncity.com/article/lafayette-walnut-creek-and-contra-costa-county-join-forces-construct-veterans-memorial

### Lafayette Plaza
Historic triangular town square at Mt Diablo Blvd and Moraga Rd. Elam Brown deeded the land in 1864; redesigned 1998-2001. Pony Express riders changed horses at this intersection in the early 1860s.  
*37.891720, -122.118320* (coords: approximate: Nominatim Plaza Drive, confidence low). Source: https://lafayette.granicus.com/MetaViewer.php?clip_id=764&meta_id=5405&view_id=16 ; https://www.lovelafayette.org/why-lafayette/about-lafayette/history-of-lafayette

### Pioneer Store (Benjamin Shreve's store)
Shreve's store, post office and insurance agency, opened in the early 1860s; much remodeled with a false front. Named the Pioneer Store by Robert Elam McNeil in 1902.  
*37.891637, -122.118130* (coords: US Census geocoder (matched Plaza Dr; verify), confidence low). Source: https://lafayettehistory.org/local-sites/tour/

### Town Hall Theatre
Built 1914 at School St and Moraga Rd by volunteers and the Lafayette Improvement Association. Theater use began with the Lafayette Playshop in 1941.  
*37.887815, -122.117918* (coords: OSM node/368171449, confidence high). Source: https://www.townhalltheatre.com/mission-and-history

### Lafayette United Methodist Church
The congregation moved in 1927 into the former 1893 third school building on Moraga Rd.  
*37.890026, -122.118501* (coords: US Census geocoder (address interpolation), confidence medium). Source: https://thelumc.org/our-history

### Stanley Middle School
Middle school named for M.H. Stanley.  
*37.886539, -122.113735* (coords: OSM way/31426940 centroid, confidence high). Source: https://lafayettehistory.org/wp-content/uploads/2024/06/Newsletter-January-2024.pdf

### Acalanes High School
Opened Sept 10, 1940 with a flag-raising and 406 students.  
*37.904550, -122.097379* (coords: Nominatim OSM way/31320691, confidence high). Source: https://lafayettehistory.org/wp-content/uploads/2024/06/Newsletter-January-2024.pdf

### Lafayette Community Center
City community center in Burton Valley.  
*37.865222, -122.099274* (coords: Nominatim OSM way/508537765, confidence high). Source: https://www.openstreetmap.org/way/508537765

### Lafayette Chamber of Commerce
Launched in 1947 by local businesspeople.  
*37.890135, -122.121139* (coords: OSM node/2952933815, confidence medium). Source: https://lafayettechamber.org/eras/

### Lafayette-Moraga Regional Trail (Lafayette segment)
Rail-trail on the former Sacramento Northern right-of-way (passenger service ended 1941, freight 1957). Dedicated July 4, 1976.  
*37.890320, -122.105730* (coords: Nominatim OSM way/464374988, confidence medium). Source: https://www.ebparks.org/about-us/whats-new/news/45-years-lafayette-moraga-regional-trail

### Briones Regional Park
EBRPD regional park north of Lafayette.  
*37.933667, -122.143449* (coords: Nominatim relation centroid, confidence medium). Source: https://www.openstreetmap.org/relation/10895202

### Acalanes Ridge Open Space
Open-space ridge on the Lafayette/Walnut Creek border.  
*37.913715, -122.092938* (coords: Nominatim relation centroid, confidence medium). Source: https://www.openstreetmap.org/relation/6518527

### The Gardens at Heather Farm (Walnut Creek, nearby)
Public garden; the garden association was incorporated in 1971, groundbreaking 1979.  
*37.918534, -122.044587* (coords: Nominatim OSM way/112113127, confidence high). Source: https://en.wikipedia.org/wiki/Gardens_at_Heather_Farm

### Caldecott Tunnel (west, toward Oakland)
Hwy 24 tunnel west of Orinda. Hwy 24 and BART run through Lafayette toward it.  
*37.857325, -122.212648* (coords: Nominatim OSM way, confidence high). Source: https://www.openstreetmap.org/way/9898614

### Lafayette Water Treatment Plant
EBMUD treatment plant below the dam.  
*37.889228, -122.139452* (coords: OSM way centroid, confidence high). Source: https://www.openstreetmap.org/way/775417954

### Old Buckeye Tree
Named tree in OSM, just south of Lafayette (Orinda Oaks area).  
*37.857728, -122.151420* (coords: OSM node, confidence high). Source: https://www.openstreetmap.org/node/13924510062

Not located / **GAP**: specific Mt Diablo viewpoints (no sourced vantage points yet; check terrain viewsheds); Lafayette Reservoir dam crest coordinates (use the DEM). Park Theater materials: Streamline Moderne, original 1941 Murano 'Noviol' neon glass marquee, wood-and-glass poster boxes recreated (https://lamorindaweekly.com/articles/2026/park-theater-renovation-plans-and-timeline-presented-to-city-council/). Library: "contemporary Craftsman structure of stone and wood" (https://www.lovelafayette.org/home/showpublisheddocument/197/635561390008430000).

## 4. People & Organizations (for discovery cards)
- **Elwood P. Laws** (builder/owner 1941, Park Theater): Walnut Creek theater operator who built the Park in 1941; also built Walnut Creek's El Rey Theater (1937). [https://parktheatertrust.org/history/]
- **William B. David** (architect, Park Theater): Cinema architect who designed 25+ theaters in California and Oregon in the Streamlined Moderne style, including the Park. [https://lamorindaweekly.com/articles/2026/park-theater-renovation-plans-and-timeline-presented-to-city-council/]
- **The Park Theater Trust** (savior/owner, Park Theater): All-volunteer nonprofit, first convened as a City task force; raised $3M and bought the theater for the community in Dec 2021. [https://parktheatertrust.org/]
- **CinemaSF (Adam Bergeron, Jaimi Holker)** (future operator, Park Theater): SF historic-cinema operators chosen to run the reopened Park; their first East Bay venue. [https://www.cinemasf.com/park]
- **Lafayette-Orinda Presbyterian Church** (early tenant, Park Theater): The newly founded congregation held Sunday services in the theater starting in 1954. [https://parktheatertrust.org/history/]
- **Lafayette Community Foundation** (fundraiser, Lafayette Library and Learning Center): Formed by citizens (via Lafayette Library Vision 2000, 1998) to fund the library; nearly 25% of residents gave $12.7M toward construction. [https://www.sfgate.com/opinion/article/Library-success-story-in-Lafayette-3211232.php]
- **Rick & Janet Cronk** (first major donors, Lafayette Library and Learning Center): Rick spent 30 years building Dreyer's; the couple were approached as the project's first major donors and agreed, saying nothing matters more than educating children. [https://lafayettehistory.org/oral-history-rick-janet-cronk-march-27th-2009/]
- **Glenn Seaborg** (namesake, Lafayette Library and Learning Center): Nobel laureate and 40-year Lafayette resident, honored by the atrium and the Glenn Seaborg Learning Consortium of 12 Bay Area institutions. [https://www.lovelafayette.org/home/showpublisheddocument/234/635561390008430000]
- **Killefer Flammang Architects** (architect, Lafayette Library and Learning Center): Won the City's design competition, drawing on ideas from 1,000+ residents. [https://www.lovelafayette.org/home/showpublisheddocument/197/635561390008430000]
- **Don Tatzin** (mayor, Lafayette Library and Learning Center): Mayor who signed the City's 2009 support for the Seaborg Consortium; the Don Tatzin Community Hall in the library bears his name. [https://lafayette.granicus.com/MetaViewer.php?clip_id=598&meta_id=4349&view_id=3]
- **Lafayette Historical Society** (keeper of town memory, Lafayette Historical Society): Runs the town's oral-history archive and the downtown history tour. [https://lafayettehistory.org/local-sites/tour/]
- **Jeff Heaton** (creator, Lafayette Hillside Memorial (The Crosses of Lafayette)): Local contractor who planted the first 19 crosses in spring 2003 and relaunched the memorial on Armistice Day 2006. [https://www.lafayettehillsidememorial.org/history.html]
- **John & Louise Clark** (property owners, Lafayette Hillside Memorial (The Crosses of Lafayette)): Longtime residents who allowed the memorial on their hillside. [https://lafayettehistory.org/oral-history-louise-clark-october-14th-2010/]
- **Mt. Diablo Peace and Justice Center / Lamorinda Peace Group** (volunteers, Lafayette Hillside Memorial (The Crosses of Lafayette)): Groups that helped build and plant thousands of crosses. [https://www.lafayettehillsidememorial.org/history.html]
- **EBMUD** (owner/builder, Lafayette Reservoir): East Bay Municipal Utility District (organized 1923) built the reservoir and opened it to the public in 1966. [https://www.ebmud.com/about-us/who-we-are/mission-and-history]
- **George Pollock Company** (dam contractor, Lafayette Reservoir): Low bidder awarded the dam contract in July 1927 for $1,370,685. [https://lafayettehistory.org/wp-content/uploads/2024/01/Newsletter-April-2023.pdf]
- **Leo J. Coleman** (EBMUD engineer, Lafayette Reservoir): Tumbled down the dam face while walking it in the dark on the night of the first cracks, in Sept 1928. [https://lafayettehistory.org/wp-content/uploads/2024/01/Newsletter-April-2023.pdf]
- **Lafayette Improvement Club (Rodebaugh, Garrett, Stanley, Meredith)** (water advocates, Lafayette Reservoir): Formed the Lafayette County Water District to bring Mokelumne water, which led Lafayette into EBMUD. [https://lafayettehistory.org/wp-content/uploads/2024/01/Newsletter-April-2023.pdf]
- **Works Progress Administration** (builder of original, Veterans Memorial Center): New Deal program that built the original 1938-39 Veterans Memorial Building at Mt Diablo Blvd and First St. [https://livingnewdeal.org/sites/old-veterans-memorial-building-lafayette-ca/]
- **Lafayette, Walnut Creek & Contra Costa County** (partners, Veterans Memorial Center): Jointly built the 2005 replacement. [https://www.westerncity.com/article/lafayette-walnut-creek-and-contra-costa-county-join-forces-construct-veterans-memorial]
- **Elam Brown** (donor of land, Lafayette Plaza): Deeded the plaza triangle to the town in 1864. [https://lafayette.granicus.com/MetaViewer.php?clip_id=764&meta_id=5405&view_id=16]
- **Benjamin Shreve** (schoolteacher/postmaster, Pioneer Store (Benjamin Shreve's store)): Stayed after the Gold Rush, ran the first school, named the town 'La Fayette' when Centerville was taken, and was postmaster for 30 years. [https://lafayettehistory.org/town-history/pictorial-history/village-life/]
- **Lafayette Improvement Association** (builder, Town Hall Theatre): Civic group that built the hall in 1914 with community volunteers. [https://www.townhalltheatre.com/mission-and-history]
- **Matthew Howard 'M.H.' Stanley** (namesake, Stanley Middle School): Lafayette businessman and school-board member who helped expand local schools. [https://lafayettehistory.org/wp-content/uploads/2024/06/Newsletter-January-2024.pdf]
- **Lafayette Chamber of Commerce** (civic org, Lafayette Chamber of Commerce): Founded 1947; a supporter of the Park Theater rescue. [https://parktheatertrust.org/]
- **Avon Wilson & Lynn Hiden ('the Bike Ladies')** (advocates, Lafayette-Moraga Regional Trail (Lafayette segment)): Started the early-1970s bike-safety push that produced the trail. [https://www.ebparks.org/about-us/whats-new/news/45-years-lafayette-moraga-regional-trail]
- **East Bay Regional Park District** (operator, Lafayette-Moraga Regional Trail (Lafayette segment)): Partnered with Lafayette and Moraga in the Trails Advisory Committee and manages the trail. [https://www.ebparks.org/trails/interpark/lafayette-moraga]
- **Elam Brown** (town founder): Led a wagon train west in 1846. Bought the 3,329-acre Rancho Acalanes for $900 in 1847 and moved in Feb 7, 1848. Served as a delegate to the 1849 Constitutional Convention and an assemblyman in the first two legislatures. Died 1889, aged 92. [https://lafayettehistory.org/town-history/pictorial-history/yankee-settlers/ ; https://www.lovelafayette.org/why-lafayette/about-lafayette/history-of-lafayette]
- **Margaret Allen Brown**: Married Elam in 1847. The $900 for the rancho was reputedly carried across the plains hidden in her 8-day clock. [https://lafayettehistory.org/town-history/pictorial-history/yankee-settlers/]
- **Nathaniel Jones**: Contra Costa's first sheriff and first buyer of land from Brown. Planted the first black locust seeds in California ("Locust Farm"). [same]
- **Candelario Valencia**: Original 1834 grantee of Rancho Acalanes. **William Leidesdorff** sold it to Brown. [https://lafayettehistory.org/local-sites/tour/ ; https://lafayettehistory.org/town-history/pictorial-history/yankee-settlers/]
- **Rotary Club of Lafayette**: Chartered April 22, 1946. [https://rotarylafayette.org/about/]
- **Lafayette Partners in Education (LPIE)**: Founded 1980 as the Lafayette Arts and Science Foundation. [https://www.lpie.org/who-we-are]
- **Lafayette Community Foundation**: Began in 1998 through Lafayette Library Vision 2000. Seeded the Park Theater Trust (2019). [https://www.lafayettecf.org/why-we-care/about-us/ ; https://parktheatertrust.org/]
- **Gardens at Heather Farm** (Walnut Creek): Garden association incorporated 1971, gardens groundbreaking 1979. Founders not yet researched (**GAP**). [https://en.wikipedia.org/wiki/Gardens_at_Heather_Farm]

## 5. Vegetation
- Hills: mixed oak woodland, open grassland, riparian corridors and eucalyptus groves. Coast live oak and valley oak are common, with California bay, buckeye and madrone. [https://www.lovelafayette.org/city-hall/city-departments/parks-trails-recreation/parks/community-park ; https://www.ebmud.com/download_file/force/882/1179?wttip20_section_3.6_biological_resources_0.pdf=]
- The City protects coast live oak, valley oak, California bay, buckeye and madrone (Tree Protection Ordinance, Ch. 6-17). [https://library.municode.com/ca/lafayette/codes/code_of_ordinances?nodeId=TIT6PLLAUS_PT4SPLAUSRE_CH6-17TRPR_6-1704PERE]
- Named tree: "Old Buckeye Tree" (OSM node 13924510062).
- **GAP:** City street-tree list (search only returned Lafayette, IN). Month-by-month hill colour: no Lafayette-specific source found. The rainfall pattern below (wet Nov-Mar, dry Jun-Sep) fits a green-winter/golden-summer grassland, but treat any month boundaries as a design choice until sourced.

## 6. Climate & sound
NOAA 1991-2020 normals, **Concord WWTP (USC00041967)**, the nearest valley station (~10 km NE, likely a bit warmer than Lafayette). The Mt Diablo Junction station is high on the mountain, so I didn't use it. [https://www.ncei.noaa.gov/access/services/data/v1?dataset=normals-monthly-1991-2020&stations=USC00041967&format=csv&dataTypes=MLY-TMAX-NORMAL,MLY-TMIN-NORMAL,MLY-PRCP-NORMAL]

| Mon | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hi °F | 58.4 | 63.2 | 67.7 | 72.2 | 78.0 | 84.6 | 88.3 | 88.2 | 86.1 | 78.2 | 66.7 | 58.7 |
| Lo °F | 41.7 | 44.1 | 46.8 | 49.2 | 53.1 | 56.7 | 58.3 | 58.8 | 57.6 | 53.1 | 45.9 | 41.2 |
| Rain in | 3.46 | 3.57 | 2.57 | 1.23 | 0.61 | 0.12 | 0.00 | 0.02 | 0.06 | 0.68 | 1.87 | 3.55 |

Sun at 37.886,-122.118, computed with the `astral` library (NOAA solar algorithm), local time:
- 2026-03-20: sunrise 07:11 PDT, sunset 19:20 PDT
- 2026-06-21: sunrise 05:46 PDT, sunset 20:33 PDT
- 2026-09-22: sunrise 06:56 PDT, sunset 19:04 PDT
- 2026-12-21: sunrise 07:20 PST, sunset 16:52 PST

**GAP:** fog and marine-layer behaviour (no source found yet). Ambient sounds: BART trains run in the Hwy 24 median (https://en.wikipedia.org/wiki/Lafayette_station_(BART)). Bird species (acorn woodpecker, wild turkey) still need eBird or iNaturalist citations, e.g. https://ebird.org/hotspot for Lafayette Reservoir. **GAP.**

## 7. Lore & easter-egg seeds (all sourced above)
- Name game: the town was called Dog Town, Brown's Corner, Brown's Mill, Acalanus and Centerville before Shreve picked "La Fayette" in 1857. The spelling became "Lafayette" in 1932. [lovelafayette.org history]
- Pony Express horse change at Mt Diablo/Moraga in the early 1860s. [same]
- Margaret's 8-day clock with $900 hidden inside, as a collectible.
- The 1928 dam slide and engineer Coleman's tumble in the dark. The dam was redesigned 40 ft lower. [LHS Apr 2023 newsletter]
- Park Theater opening night, Aug 21, 1941: Abbott & Costello's *Hold That Ghost*. On Sunday mornings it was a church, with popcorn left over. [parktheatertrust.org/history]
- Crosses sign changed to "Remember" in 2022. [lafayettehillsidememorial.org]
- BART opened May 21, 1973. The trail was dedicated July 4, 1976 (US Bicentennial). The city incorporated July 1968, 3,279 to 2,692. [Wikipedia; EBRPD; https://www.lovelafayette.org/home/showpublisheddocument/5367/636673441980530000]
- Orchard past: pears, prunes, plums and walnuts. The Malley "Peardale" ranch. [https://lafayettehistory.org/oral-history-marianne-millette-malley-march-5th-2014/ ; https://lafayettehistory.org/oral-history-charles-reynolds-march-20th-1979/]
- **GAP:** downtown "Walnut"/"Pear" street-name history and the turkey lore are unsourced.
