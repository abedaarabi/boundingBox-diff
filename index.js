const fs = require("fs");
const path = require("path");

const ForgeSDK = require("forge-apis");
const writeXlsxFile = require("write-excel-file/node");
const { ModelDerivativeClient, ManifestHelper } = require("forge-server-utils");
const { SvfReader, GltfWriter } = require("forge-convert-utils");

const { default: axios } = require("axios");

require("dotenv").config({ path: "./.env" });
const { FORGE_CLIENT_ID, FORGE_CLIENT_SECRET } = process.env;

async function run(urn) {
  let arr = [];
  let gGuid = "";
  const auth = {
    client_id: FORGE_CLIENT_ID,
    client_secret: FORGE_CLIENT_SECRET,
  };
  const modelDerivativeClient = new ModelDerivativeClient(auth);
  const manifestHelper = new ManifestHelper(
    await modelDerivativeClient.getManifest(urn)
  );

  const derivatives = manifestHelper.search({
    type: "resource",
    role: "graphics",
  });

  for (const derivative of derivatives.filter((d) => {
    if (
      d.mime === "application/autodesk-svf" && //how about otg & svf2
      d.urn.includes("New Construction.svf")
    ) {
      return true;
    } else return false;
  })) {
    gGuid = derivative.guid;
    const reader = await SvfReader.FromDerivativeService(
      urn,
      derivative.guid,
      auth
    );

    for await (const fragment of reader.enumerateFragments()) {
      const result = {
        dbId: fragment.dbID,
        bbox: unionBoundingBoxes(fragment.bbox),
      };

      const bbox = arr.find((i) => i.dbId === fragment.dbID);

      !bbox && arr.push(result);
    }
  }

  const properties = await getModelviewProperties(urn, gGuid);
  const projectMetaData = properties.data.collection;
  const resultProps = hasIdentityData(projectMetaData);

  const filteredRsult = resultProps.map((prop) => {
    const propResult = topLevelObj(prop);

    const fargments = arr.map((fargment) => {
      if (propResult.objectid === fargment.dbId) {
        const rvtdbId = Number(propResult?.name.split("[")[1].split("]")[0]);
        return {
          ...propResult,
          rvtdbId,
          boundingBox: JSON.stringify(fargment.bbox),
        };
      }
    });
    return fargments.filter((i) => i);
  });

  return filteredRsult?.flat();
}

async function name() {
  //k09
  const currentURN =
    "dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLlZ1b3hTMDhWUjJLN0JLOWtOd0x4c0E_dmVyc2lvbj0xOQ";
  // const prevURN =
  //   "dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLkVzUE5rX0d4VFcybV9EWFh1VXNjLUE_dmVyc2lvbj0xMDk";
  const prevURN = getPrevURN(currentURN, 1);
  console.log(prevURN);

  const modelV1 = await run(prevURN);
  const modelV2 = await run(currentURN);

  const result1 = getKeyIndex(modelV1);
  const result2 = getKeyIndex(modelV2);

  const set = Array.from(new Set([...result1.ids, ...result2.ids]));

  const resultElements = set.map((externalId) => {
    const idx1 = result1.index[externalId];
    const idx2 = result2.index[externalId];

    //Deep comparing params🧮

    if (
      modelV1[idx1] &&
      modelV2[idx2] &&
      modelV1[idx1].externalId === modelV2[idx2].externalId
    ) {
      for (const key in modelV1[idx1]) {
        if (key !== "objectid" && modelV1[idx1][key] !== modelV2[idx2][key]) {
          const befor = modelV1[idx1];
          const after = modelV2[idx2];
          // const rvtdbId = modelV2[idx1]["rvtdbId"];
          // const name = modelV2[idx1]["name"];
          const whatIschanged = {
            ...befor,
            ...after,
          };

          return {
            id: externalId,
            msg: "element changed",
            ...whatIschanged,

            // elt: { befor, after },
          };
        }
      }
    }
    if (!idx1 && idx2) {
      return { id: externalId, msg: "element added", ...modelV2[idx2] };
    }
    if (idx1 && !idx2) {
      return {
        id: externalId,
        msg: "element removed",
        ...modelV1[idx1],
      };
    }

    // if (modelV1[idx1]?.boundingBox !== modelV2[idx2]?.boundingBox) {
    //   return { id: externalId, msg: "element moved", elt: modelV2[idx2] };
    // }
  });
  // .map((item) => {
  //   if (item?.msg === "element changed") {
  //     return item.elt;
  //   }
  // });

  // console.log(JSON.stringify(resultElements, null, 2));

  const elementChanged = resultElements.filter(
    (item) => item?.msg === "element changed"
  );
  await writeXls("element changed.xlsx", elementChanged);

  const elementAdded = resultElements.filter(
    (item) => item?.msg === "element added"
  );

  await writeXls("element added.xlsx", elementAdded);

  const elementRemoved = resultElements.filter(
    (item) => item?.msg === "element removed"
  );
  await writeXls("element removed.xlsx", elementRemoved);
}
name();

function getKeyIndex(array) {
  const index = array.reduce((acc, val, idx) => {
    acc[val.externalId] = idx;
    return acc;
  }, {});
  const ids = array.map((i) => i.externalId);

  return { index, ids };
}

function unionBoundingBoxes(bbox1) {
  return [
    +bbox1[0].toFixed(2),
    +bbox1[1].toFixed(2),
    +bbox1[2].toFixed(2),
    +bbox1[3].toFixed(2),
    +bbox1[4].toFixed(2),
    +bbox1[5].toFixed(2),
  ];
}

const hasIdentityData = (arr) => {
  const eltCollection = arr?.filter((elt) => {
    if (
      elt.properties["Identity Data"] &&
      elt.properties["Identity Data"]["Type Name"]
    ) {
      return true;
    } else return false;
  });

  return eltCollection;
};

async function getModelviewProperties(urn, guid) {
  const credentials = await oAuth2();
  const guidd = new ForgeSDK.DerivativesApi();

  while (true) {
    try {
      // const itemProperties = await guidd.getModelviewProperties(
      //   urn,
      //   guid,
      //   { forceget: true },
      //   null,
      //   credentials
      // );
      // console.log(itemProperties);
      // return;
      const url = `	https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn}/metadata/${guid}/properties`;
      const response = await axios({
        method: "GET",
        url,
        params: {
          forceget: true,
        },
        headers: {
          "content-type": "application/vnd.api+json",
          Authorization: `Bearer ${credentials}`,
          "x-user-id": "4RL5NPRJ3LNM",
          "x-ads-derivative-format": "fallback",
        },
      });
      if (response.status === 202) {
        console.log(` Status:${response.status} Preparing json data for model`);
        await delay(10 * 1000);
        continue;
      } else {
        return response.data;
      }
    } catch (error) {
      console.log(error.message);
    }
  }
}

const oAuth2TwoLegged = new ForgeSDK.AuthClientTwoLegged(
  FORGE_CLIENT_ID,
  FORGE_CLIENT_SECRET,
  ["data:read", "data:create", "data:write"],
  false
);

async function oAuth2() {
  const credentials = await oAuth2TwoLegged.authenticate();

  return credentials.access_token;
}

const dummyObject = {
  name: "key not exist",
  rvtdbId: "key not exist",
  objectid: "key not exist",
  // version_id: "key not exist",
  externalId: "key not exist",
  "Type Name": "key not exist",
  boundingBox: "key not exist",
  Workset: "key not exist",
  "Type Sorting": "key not exist",
  CCSTypeID: "key not exist",
  CCSTypeID_Type: "key not exist",
  CCSClassCode_Type: "key not exist",
  Length: "key not exist",
  Area: "key not exist",
  Volume: "key not exist",
};

const isObj = (obj) => typeof obj === "object" && !Array.isArray(obj);
const topLevelObj = (obj) => {
  let item = {};
  for (const key in obj) {
    if (isObj(obj[key])) {
      const result = topLevelObj(obj[key]);

      item = { ...item, ...result };
    } else {
      if (Object.keys(dummyObject).includes(key)) {
        // item[key] = obj[key];

        item = { ...item, [key]: obj[key] };
      }
    }
  }
  return item;
};
async function delay(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

//   try {
//     let content = JSON.stringify(resultElements, null, 2);

//     fs.writeFileSync("test.csv", content);
//     console.log("Done*********");
//   } catch (error) {
//     console.log(error);
//   }

/*

  try {
    let content = JSON.stringify(model, null, 2);

    fs.writeFileSync("test.csv", content);
    console.log("Done*********");
  } catch (error) {
    console.log(error);
  }

function getObjectBounds(model, dbid) {
    const tree = model.getInstanceTree();
    const frags = model.getFragmentList();
    let objectBounds = new THREE.Box3();
    let fragBounds = new THREE.Box3();
    tree.enumNodeFragments(dbid, function (fragid) {
        frags.getWorldBounds(fragid, fragBounds);
        objectBounds.union(fragBounds);
    }, true);
    return objectBounds;
}
**/

function getPrevURN(currentURN, pervVersion) {
  let buff = new Buffer(currentURN, "base64");
  let text = buff.toString("ascii");

  const versionNumber = +text.split("=")[1] - pervVersion;
  const urn = text.split("=")[0];

  const prevURN = urn + "=" + versionNumber;

  const prev = Buffer.from(prevURN)
    .toString("base64")
    .replace("/", "_")
    .replace("=", "");

  return prev;
}

async function writeXls(fileName, data) {
  try {
    const schema = Object.keys({ ...dummyObject }).map((i) => {
      return {
        column: i,
        //   type: String,
        width: 15,
        value: (elt) => elt[i],
      };
    });
    await writeXlsxFile(data, {
      schema,
      headerStyle: {
        backgroundColor: "#eeeeee",

        fontWeight: "bold",
        align: "center",
      },
      filePath: "output/" + fileName,
    });
    console.log("Done*********");
  } catch (error) {
    console.log(error);
  }
}
