import assert from "node:assert/strict";
import test from "node:test";
import { camerasFromPayload, freshImageUrl, parseCameraXml } from "./cameras.ts";

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<image-list>
  <image>
    <key>H106F</key>
    <region>香港島</region>
    <district>中西區</district>
    <description>干諾道中近交易廣場 [H106F]</description>
    <latitude>22.2859674</latitude>
    <longitude>114.1557495</longitude>
    <url>https://tdcctv.data.one.gov.hk/H106F.JPG</url>
  </image>
  <image>
    <key>AID01101</key>
    <region>香港島</region>
    <district>南區</district>
    <description>香港仔海傍道 [AID01101]</description>
    <latitude>22.248083364</latitude>
    <longitude>114.152524708</longitude>
    <url>https://tdcctv.data.one.gov.hk/AID01101.JPG</url>
  </image>
  <image>
    <key>BAD</key>
    <latitude>1</latitude>
    <longitude>1</longitude>
    <url>https://example.com/not-a-camera.jpg</url>
  </image>
</image-list>`;

test("camera list keeps Hong Kong points and splits detectors from cameras", () => {
  const cameras = parseCameraXml(sample);
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0]?.kind, "cctv");
  assert.equal(cameras[1]?.kind, "aid");
  assert.equal(cameras[0]?.description.includes("交易廣場"), true);
});

test("the browser only accepts snapshots served by this site", () => {
  const cameras = camerasFromPayload([
    { key: "H106F", kind: "cctv", description: "交易廣場", region: "香港島", district: "中西區", lng: 114.15, lat: 22.28, url: "/api/snapshot/H106F" },
    { key: "H106F", kind: "cctv", description: "外站", region: "", district: "", lng: 114.15, lat: 22.28, url: "https://tdcctv.data.one.gov.hk/H106F.JPG" },
  ]);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0]?.url, "/api/snapshot/H106F");
});

test("snapshot urls refresh on the two-minute government interval", () => {
  const first = freshImageUrl("https://tdcctv.data.one.gov.hk/H106F.JPG", 120_000);
  const same = freshImageUrl("https://tdcctv.data.one.gov.hk/H106F.JPG", 180_000);
  const next = freshImageUrl("https://tdcctv.data.one.gov.hk/H106F.JPG", 240_000);
  assert.equal(first, same);
  assert.notEqual(first, next);
  assert.equal(freshImageUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});
