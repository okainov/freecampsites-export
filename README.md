# Freecampsites Export

## Disclaimer

This code is provided **"as is"**, for **educational and research purposes only**.  
It is **not affiliated with, endorsed by, or supported by [freecampsites.net](https://freecampsites.net/)** in any way. Proceed at your own risk.

## About

This utility script allows exporting publicly visible data from [freecampsites.net](https://freecampsites.net), which currently does not provide an official data export feature.  
It is intended as a **technical demonstration** of data transformation and merging workflows, not for production use or large-scale scraping.


## Usage

1. Open freecampsites.net in Chrome
2. Open DevTools (F12) and go to Snippets tab in Sources tab.
3. Create new snipped and paste code from `freecampsites.js` there
4. Modify initial parameters to fit the area to be parsed:

```js
// ===== CONFIG =====
const LAT_MIN = 35.0, LAT_MAX = 40.0;
const LON_MIN = -120.0, LON_MAX = -115;
const STEP = 1.0; // Probing US with 0.25 step produced too many duplicated, so probably 0.5-1 degree would be ideal.

const CONCURRENCY = 2;
const SLEEP_BETWEEN = 500;       // ms between tasks
const MAX_PER_RUN = 50; 
```

5. Execute the script
6. When it's completed, you'll see download prompt for GeoJSON file for just this batch. You can already use it.

7. However, if you need to parse it further, execute in console `await runIncremental();` which would run the next batch, repeat until happy.
8. When done, execute `downloadAll()` in console to get download prompt for all data in one file. It does not do de-duplication by ID. Also the size is limited by localStorage size, so you'll need to clean `::data` part of localstorage every now and then. NOTE: do not clean

## Result example

Resulted GeoJSON will look like those:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [
          22.554674,
          46.523084
        ]
      },
      "properties": {
        "id": 132814,
        "type": "campsite",
        "name": "Camping Valea Sighitelului",
        "latitude": 46.523084,
        "longitude": 22.554674,
        "distance": 120,
        "url": "https://freecampsites.net/camping-valea-sighitelului/",
        "city": "Sighi?tel",
        "county": "Campani",
        "region": "Bihor County",
        "country": "Romania",
        "excerpt": "Campsite in Apuseni Natural Park free of charge",
        "ratings_average": 0,
        "ratings_count": 0,
        "ratings_value": 0,
        "type_specific": {
          "icon": "https://freecampsites.net/wp-content/themes/freecampsites/images/map-icons/fc_icon-tent-green-24x24.png",
          "amenities": "0",
          "activities": "2048",
          "fee": "Free"
        }
      }
    },
```

`amenities` and `activities` are bit-fields with following mapping:
```js
                amenities_map = {
                    1: 'bbq_grill',
                    2: 'boat_ramp',
                    4: 'drinking_water',
                    8: 'dump_station', 
                    16: 'electricity',
                    32: 'fire_ring',
                    64: 'horse_corral',
                    128: 'laundry',
                    256: 'pay_phone',
                    512: 'picnic_tables',
                    1024: 'restrooms',
                    2048: 'playground',
                    4096: 'sewer',
                    8192: 'shooting_range',
                    16384: 'trash_cans',
                    32768: 'showers',
                    65536: 'near_water',
                    131072: 'ada_accessible',
                    262144: 'pets_welcome'
                }

                activities_map = {
                    1: 'offroad',
                    2: 'biking',
                    4: 'boating',
                    8: 'fishing',
                    16: 'hiking',
                    32: 'horse_trails',
                    64: 'hunting',
                    128: 'swimming',
                    256: 'rock_climbing',
                    512: 'water_sports',
                    1024: 'wildlife_viewing',
                    2048: 'tent_camping',
                    4096: 'rv_parking',
                    8192: 'winter_sports',
                }
```

URLs on the website itself are usually constructed from IDs like `https://freecampsites.net/#!78026&query=sitedetails`, however URL from API response also works fine.

## See also

- Of course, freecampsites.net itself is a great website (ok, website itself is not so great, but the dataset was for sure worth working on it)
- Check out [Wildcamp.place](https://wildcamp.place) which is newer, better and more user-friendly website where everyone can add places to stay and camp!
