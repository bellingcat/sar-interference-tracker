// This is the source code for the Bellingcat Radar Interference Tracker.
// Tool Link: https://ollielballinger.users.earthengine.app/view/bellingcat-radar-interference-tracker
// GEE Link: https://code.earthengine.google.com/23c69d3233af216ff7b6c357bdb6b143


// The tool provides a user interface which enables the analysis of Radio Frequency Interference (RFI)
// Most of the RFI caused by ground-based systems are military radars
// Investigating the spatial and temporal characteristics of the signal can yield information on the deployment of military radar systems

// Below is an overview of the 10 sections

// 1. Load Data
// 2. Configure Map
// 3. Set up user interface panel
// 4. Create image aggregation dropdown
// 5. Create opacity slider
// 6. Create date selector
// 7. Create RFI chart
// 8. Create "Visit Example Locations" dropdown
// 9. Map Setup
// 10. Initialize App

// For queries, please contact ollie.ballinger@sant.ox.ac.uk

// --------------------- Step 1: Load Data  --------------------------------

// Load country outlines
var countries = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0");

var country_outlines = ee.Image().byte().paint({
  featureCollection: countries,
  width: 3,
  color: "FFFFFF",
});

// Load sentinel-1 imagery
var sentinel1 = ee.ImageCollection("COPERNICUS/S1_GRD");

// RFI primarily shows up in the VH polarization, but including VV lets you create an RGB visualization and distinguish RFI from background imagery better
var vh = sentinel1
  // Filter to get images with VV and VH dual polarization.
  .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
  .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
  // Filter to get images collected in interferometric wide swath mode.
  .filter(ee.Filter.eq("instrumentMode", "IW"));

// Filter to get images from different look angles.
var vhA = vh.filter(ee.Filter.eq("orbitProperties_pass", "ASCENDING"));
var vhD = vh.filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING"));

// --------------------- Step 2: Configure Map  --------------------------------

// Create the main map
var mapPanel = ui.Map();
var layers = mapPanel.layers();

// Creating a country outline layer that can be added later
var country_layer = ui.Map.Layer(
  country_outlines,
  { palette: "FFFFFF", min: 0, max: 1 },
  "country outlines",
  true
);

// Remove unnecessary map functionalities
mapPanel.setControlVisibility({
  all: false,
  zoomControl: true,
  mapTypeControl: true,
});

// --------------------- Step 3: Set up the User Interface Panel  --------------------------------

// Create the main panel
var inspectorPanel = ui.Panel({ style: { width: "30%" } });

// Create an intro panel with labels.
var intro = ui.Panel([
  ui.Label({
    value: "Bellingcat Radar Interference Tracker",
    style: { fontSize: "20px", fontWeight: "bold" },
  }),
  ui.Label(
    "This map shows interference from ground based radar systems as red and blue streaks. Most of these are military radars. Click on the map to generate a historical graph of Radio Frequency Interference (RFI) at a particular location:"
  ),
]);

// --------------------- Step 4: Create imagery aggregation menu  --------------------------------

// Create UI label for the dropdown menu
var layerLabel = ui.Label("Display imagery aggregated by:");

// Layer visualization dictionary
var layerProperties = {
  Day: {
    name: "Day",
    defaultVisibility: false,
  },
  Month: {
    name: "Month",
    defaultVisibility: true,
  },
  Year: {
    name: "Year",
    defaultVisibility: false,
  },
};

// Get keys from dictionary
var selectItems = Object.keys(layerProperties);

// Create dropdown menu to toggle between imagery aggregated at different timescales
var layerSelect = ui.Select({
  items: selectItems,
  value: selectItems[1],
  onChange: function (selected) {
    // Loop through the map layers and compare the selected element to the name
    // of the layer. If they're the same, show the layer and set the
    // corresponding legend.  Hide the others.
    mapPanel.layers().forEach(function (element, index) {
      element.setShown(selected == element.getName());

      var dict = {
        Day: "daily",
        Month: "monthly",
        Year: "yearly",
      };

      // Add a line that provides information on the level of aggregation of the imagery currently being shown
      image_info.setValue(
        "You are currently viewing " +
          dict[selected] +
          " Sentinel-1 imagery from "
      );
    });
  },
});

// --------------------- Step 5: Create Opacity Slider  --------------------------------

var opacitySlider = ui.Slider({
  min: 0,
  max: 1,
  value: 1,
  step: 0.01,
});
opacitySlider.onSlide(function (value) {
  mapPanel.layers().forEach(function (element, index) {
    element.setOpacity(value);
  });
});

var opacityLabel = ui.Label("Opacity: ");

// Create panel to hold the aggregation dropdown menu and the opacity slider

var viewPanel = ui.Panel({
  widgets: [layerLabel, layerSelect, opacityLabel, opacitySlider],
  style: { stretch: "horizontal" },
  layout: ui.Panel.Layout.Flow("horizontal"),
});

// --------------------- Step 6: Create Date Selector  --------------------------------

// Get date range for Sentinel-1 imagery, backdate current date by one week to ensure imagery is available
var start = ee.Date(sentinel1.first().get("system:time_start"));
var now = ee.Date(Date.now()).advance(-1, "week");

// Format date to display it to the user
var date = ui.Label(now.format("MMMM dd, YYYY").getInfo());
var image_info = ui.Label(
  "You are currently viewing monthly Sentinel-1 imagery from "
);

// Run this function on a change of the dateSlider.

var slide = function (range) {
  date.setValue(ee.Date(range.start()).format("MMMM dd, YYYY").getInfo());

  // From the selected date, get the year and month for aggregation
  var year = range.start().getRange("year");
  var month = range.start().getRange("month");

  // Get imagery for the month/year, disaggregated by ascending/descending orbital trajectory
  var vhA_monthly = vhA.filterDate(month.start(), month.end());
  var vhD_monthly = vhD.filterDate(month.start(), month.end());

  var vhA_annual = vhA.filterDate(year.start(), year.end());
  var vhD_annual = vhD.filterDate(year.start(), year.end());

  // Create a composite at different polarizations and look angles.
  // Note: we're selecitng the maximum values for each time period-- this bring out the RFI
  var comp_monthly = ee.Image.cat([
    vhA_monthly.select("VH").max(),
    ee
      .ImageCollection(vhA_monthly.select("VV").merge(vhD_monthly.select("VV")))
      .max(),
    vhD_monthly.select("VH").max(),
  ]);

  var comp_annual = ee.Image.cat([
    vhA_annual.select("VH").max(),
    ee
      .ImageCollection(vhA_annual.select("VV").merge(vhD_annual.select("VV")))
      .max(),
    vhD_annual.select("VH").max(),
  ]);

  // Create layers, and visualize based on which value is selected in the dropdown menu
  var daily = ui.Map.Layer(
    vh.filterDate(range.start(), range.end()),
    { min: [-25, -20, -25], max: [0, 10, 0], opacity: 0.8 },
    "Day",
    "Day" == layerSelect.getValue()
  );
  var monthly = ui.Map.Layer(
    comp_monthly,
    { min: [-25, -20, -25], max: [-10, 0, -10], opacity: 0.8 },
    "Month",
    "Month" == layerSelect.getValue()
  );
  var yearly = ui.Map.Layer(
    comp_annual,
    { min: [-25, -20, -25], max: [-10, 0, -10], opacity: 0.8 },
    "Year",
    "Year" == layerSelect.getValue()
  );

  // Add layers to map

  mapPanel.layers().set(0, daily);
  mapPanel.layers().set(1, monthly);
  mapPanel.layers().set(2, yearly);
};

// Create dateSlider to trigger the function Slide function
var dateSlider = ui
  .DateSlider({
    start: start,
    end: now,
    value: null,
    period: 1,
    onChange: slide,
    style: { height: "0px" },
  })
  .setValue(now);

// --------------------- Step 7: Create RFI Chart  --------------------------------

// Create panels to hold lon/lat values.
var lon = ui.Label();
var lat = ui.Label();

// Generates a new time series chart of RFI for the given coordinates.
var generateChart = function (coords) {
  // Update the lon/lat panel with values from the click event.
  lon.setValue("lon: " + coords.lon.toFixed(2));
  lat.setValue("lat: " + coords.lat.toFixed(2));

  // Add a dot for the point clicked on.
  var point = ee.FeatureCollection(ee.Geometry.Point(coords.lon, coords.lat));

  var dot = ui.Map.Layer(
    point.style({ color: "black", fillColor: "#00FFFF", pointSize: 7 }),
    {},
    "clicked location"
  );
  // Add the dot as the second layer, so it shows up on top of the composite.
  mapPanel.layers().set(3, dot);

  // Make a chart from the time series.
  var rfiChart = ui.Chart.image
    .series(vh.select("VH"), point, ee.Reducer.max(), 500)
    .setOptions({
      title:
        "Radio Frequency Interference at (lon:" +
        coords.lon.toFixed(2) +
        ", lat:" +
        coords.lat.toFixed(2) +
        ")",
      vAxis: { title: "VH " },
      lineWidth: 2,
      series: "Area of Interest",
    });
  // Add the chart at a fixed position, so that new charts overwrite older ones.
  inspectorPanel.widgets().set(3, rfiChart);
  var getDate = function (callback) {
    dateSlider.setValue(ee.Date(callback));
  };
  rfiChart.onClick(getDate);
};

// --------------------- Step 8: Create "Visit Example Locations" dropdown  --------------------------------

// Define functions triggered on selection of locations from the dropdown
// These generally ensure that the correct layers are being displayed,
// Display some information on the location being viewed

var contact = ui.Panel([
  ui.Label(
    "Please direct queries to @oballinger",
    { "font-size": "9px" },
    "https://twitter.com/oballinger"
  ),
]);

var configureExample = function (text, opacity) {
  mapPanel.layers().map(function (layer) {
    layer.setShown(false);
  });
  mapPanel.layers().get(1).setShown(true);
  mapPanel.layers().get(3).setShown(true);
  mapPanel.layers().get(1).setOpacity(opacity);

  var textpanel = ui.Panel(text);
  inspectorPanel.widgets().set(10, textpanel);
  inspectorPanel.widgets().set(11, contact);
};

// Dammam (Saudi Arabia) Patriot Missile
var loc1_function = function () {
  // Draw boxes around the different components of the Patriot Missile identified in Dammam
  var radar = ee.Geometry.Polygon(
      [
        [
          [49.95055676743417, 26.60577361047956],
          [49.95055676743417, 26.605668090179968],
          [49.9506694202128, 26.605668090179968],
          [49.9506694202128, 26.60577361047956],
        ],
      ],
      null,
      false
    ),
    power = ee.Geometry.Polygon(
      [
        [
          [49.95069356009393, 26.6057028639258],
          [49.95069356009393, 26.605602139943276],
          [49.950796825141005, 26.605602139943276],
          [49.950796825141005, 26.6057028639258],
        ],
      ],
      null,
      false
    ),
    control = ee.Geometry.Polygon(
      [
        [
          [49.9507780496779, 26.605594945369706],
          [49.9507780496779, 26.605497818582162],
          [49.95088399693399, 26.605497818582162],
          [49.95088399693399, 26.605594945369706],
        ],
      ],
      null,
      false
    ),
    launchers = ee.Geometry.MultiPolygon(
      [
        [
          [
            [49.949325633496336, 26.60563452803374],
            [49.949325633496336, 26.6054690527739],
            [49.94951338812738, 26.6054690527739],
            [49.94951338812738, 26.60563452803374],
          ],
        ],
        [
          [
            [49.94854242846399, 26.6054582609008],
            [49.94854242846399, 26.60532396195055],
            [49.948700678795866, 26.60532396195055],
            [49.948700678795866, 26.6054582609008],
          ],
        ],
        [
          [
            [49.9505621318522, 26.606960694701094],
            [49.9505621318522, 26.606833592010936],
            [49.950706971139006, 26.606833592010936],
            [49.950706971139006, 26.606960694701094],
          ],
        ],
        [
          [
            [49.9504172925654, 26.60782678197863],
            [49.9504172925654, 26.60769968025089],
            [49.95055140301614, 26.60769968025089],
            [49.95055140301614, 26.60782678197863],
          ],
        ],
      ],
      null,
      false
    );

  var outline = ee
    .Image()
    .byte()
    .paint({
      featureCollection: radar,
      width: 5,
      color: 1,
    })
    .paint({
      featureCollection: power,
      width: 5,
      color: 2,
    })
    .paint({
      featureCollection: control,
      width: 5,
      color: 3,
    })
    .paint({
      featureCollection: launchers,
      width: 5,
      color: 0,
    });

  mapPanel.addLayer(outline, {
    palette: ["black", "red", "green", "blue"],
    min: 0,
    max: 3,
  });

  // Display information on the site
  var lab1 = ui.Label(
    "This is a MIM-104 Patriot PAC-2 missile defense system stationed at an Aramco oil refinery in Dammam, Saudi Arabia. At the center of the system are three vehicles: the AN/MPQ-53 radar (red), the control station (blue), and the power generator truck (green). The black boxes indicate the missile launcher trucks."
  );
  var link = ui.Label(
    "This video provides an overivew of the Patriot missile system.",
    {},
    "https://youtu.be/NG8wF1o6r58?t=29"
  );
  var lab2 = ui.Label(
    "By gradually zooming out and increasing the opacity of the Synthetic Aperture Radar layer using the slider above, it becomes clear that the radar on this missile defense system causing significant interference with the Sentinel-1 satellite."
  );
  var lab3 = ui.Label(
    "The RFI Graph above shows that the radar was first turned on a this location around April 26th, 2021. There is a drop in intereference in July and August, suggesting that it was turned off during this period. The radar comes back online in September, and has been on ever since."
  );

  configureExample([lab1, link, lab2, lab3], 0.1);
};

// Dimona Radar Facility
var loc2_function = function () {
  var lab1 = ui.Label(
    'Located in Israel\'s Negev Desert, the Dimona Radar Facility is a "top-secret X-band radar staffed by around 120 American technicians".',
    {},
    "http://content.time.com/time/world/article/0,8599,1846749,00.html"
  );
  var lab2 = ui.Label(
    "The radar can monitor the take-off of any aircraft or missile up to 1,500 miles away, which would give Israel an extra 60-70 seconds to react if Iran fired a missile. The radar is so powerful that Israeli officials feared that RFI would impact the accuracy of anti-tank missiles being tested nearby."
  );
  var lab3 = ui.Label(
    "Israel's Negev Nuclear Research Center is located in the same valley, just a few kilometers to the north. The RFI Graph above shows consistent and strong interference since 2017."
  );

  configureExample([lab1, lab2, lab3], 0.8);
};

// Rostov Radar
var loc3_function = function () {
  var lab1 = ui.Label(
    "Rostov-On-Don has seen a significant military buildup and hosts the headquarters of Russia’s 4th Air and Air Defense Forces Command. The dot indictes a facility that is likely the source of the RFI."
  );
  var lab2 = ui.Label(
    'According to Wikimapia, this facility is operated by FEDERAL STATE UNITARY ENTERPRISE "ROSTOV-ON-DON RESEARCH INSTITUTE OF RADIO COMMUNICATIONS"',
    {},
    "https://www.openstreetmap.org/way/106283207#map=17/47.35430/39.78441"
  );
  var lab3 = ui.Label(
    "Its official registration lists it as a subsidiary of the Federal Security Services of the Russian Federation (FSB). The RFI graph above shows radar activity throughout June and July 2021. You can view the facility likely causing this interference by zooming in to the blue dot and reducing the opacity using the slider."
  );

  configureExample([lab1, lab2, lab3], 0.8);
};

// White Sands Missile Range
var loc4_function = function () {
  var lab1 = ui.Label(
    "The White Sands Missile Range (WSMR) is a U.S. Military base located in New Mexico.",
    {},
    "https://en.wikipedia.org/wiki/White_Sands_Missile_Range"
  );
  var lab2 = ui.Label(
    "Patriot missiles are often tested at Launch Complex 38. The RFI graph shows significant radar activity on December 14th, 2021, and February 23rd, 2020. Smaller signatures are also visible in April and June 2021, as well as at various points since 2017."
  );

  configureExample([lab1, lab2], 0.8);
};

// Some pre-set locations of interest that will be loaded into a pulldown menu.
// Dict contains the coordinates, zoom level, date range, and function to be triggered when navigating to these locations
var locationDict = {
  "Dammam, Saudi Arabia": {
    lon: 49.949916,
    lat: 26.606379,
    zoom: 19,
    date: "2022-01-01",
    func: loc1_function,
  },
  "Dimona Radar Facility, Israel": {
    lon: 35.0948799,
    lat: 30.9685089,
    zoom: 11,
    date: "2019-02-19",
    func: loc2_function,
  },
  "Rostov-on-Don, Russia": {
    lon: 39.783387,
    lat: 47.354445,
    zoom: 11,
    date: "2021-07-22",
    func: loc3_function,
  },
  "White Sands Missile Range, USA": {
    lon: -106.3122,
    lat: 31.9735,
    zoom: 10,
    date: "2021-12-14",
    func: loc4_function,
  },
};

// Create the location pulldown.
var locations = Object.keys(locationDict);
var locationSelect = ui
  .Select({
    items: locations,
    onChange: function (value) {
      var location = locationDict[value];

      mapPanel.setCenter(location.lon, location.lat, location.zoom);

      generateChart({
        lon: location.lon,
        lat: location.lat,
      });

      dateSlider.setValue(location.date);
      location.func();
    },
  })
  .setPlaceholder("Choose a Location");

var locationPanel = ui.Panel([
  ui.Label("Visit Example Locations", { "font-size": "24px" }),
  locationSelect,
]);

// --------------------- Step 9: Map setup  --------------------------------

// Register a callback on the default map to be invoked when the map is clicked.
mapPanel.onClick(generateChart);

// Configure the map.
mapPanel.setOptions("Satellite");
mapPanel.style().set("cursor", "crosshair");

// Initialize with a test point.
var initialPoint = ee.Geometry.Point(49.950656, 26.605644);
mapPanel.centerObject(initialPoint, 11);

// Add all of the modules created above to the User Interface Panel
inspectorPanel.add(intro);
inspectorPanel.add(dateSlider);
inspectorPanel.add(ui.Panel([lon, lat], ui.Panel.Layout.flow("horizontal")));
inspectorPanel.add(ui.Label("placeholder"));
inspectorPanel.add(
  ui.Label(
    "Click on any point in the graph above to display imagery from that date"
  )
);

inspectorPanel.add(ui.Label("View Different Layers", { "font-size": "24px" }));
inspectorPanel.add(
  ui.Panel([image_info, date], ui.Panel.Layout.flow("horizontal"))
);
inspectorPanel.add(
  ui.Label(
    "Use the dropdown below to switch between daily, monthly, and annually aggregated imagery. Annual imagery is useful for monitoring large areas over time for signs of radar activity. When a radar is spotted, monthly and daily imagery can be used for a more detailed investigation."
  )
);
inspectorPanel.add(viewPanel);
inspectorPanel.add(locationPanel);
inspectorPanel.widgets().set(11, contact);

// --------------------- Step 10: Initialize  --------------------------------

// Replace the root with a SplitPanel that contains the inspector and map.
ui.root.clear();
ui.root.add(ui.SplitPanel(inspectorPanel, mapPanel));

generateChart({
  lon: initialPoint.coordinates().get(0).getInfo(),
  lat: initialPoint.coordinates().get(1).getInfo(),
});

// Optional: add country outlines
// mapPanel.layers().set(5, country_layer)

// Add imagery aggregated by month by default.
mapPanel.layers().get(1).setShown(true);
