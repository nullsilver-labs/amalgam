import { describe, expect, it } from "vitest";

import { parseMounts } from "../src/doctor.js";

/** Trimmed from a container's /proc/mounts: an overlay root, kernel noise, two binds. */
const PROC_MOUNTS = `overlay / overlay rw,relatime 0 0
proc /proc proc rw,nosuid 0 0
tmpfs /dev tmpfs rw,nosuid 0 0
sysfs /sys sysfs ro,nosuid 0 0
devpts /dev/pts devpts rw,nosuid 0 0
/dev/sda1 /root/.amalgam ext4 rw,relatime 0 0
/dev/sda1 /workspace ext4 rw,relatime 0 0
/dev/sda1 /my\\040files ext4 rw,relatime 0 0
mqueue /dev/mqueue mqueue rw,nosuid 0 0
proc /proc/bus proc ro,relatime 0 0
`;

describe("parseMounts", () => {
  it("keeps the mounts a user cares about", () => {
    expect(parseMounts(PROC_MOUNTS)).toEqual([
      { mountPoint: "/", type: "overlay" },
      { mountPoint: "/root/.amalgam", type: "ext4" },
      { mountPoint: "/workspace", type: "ext4" },
      { mountPoint: "/my files", type: "ext4" },
    ]);
  });

  it("survives an empty or truncated file", () => {
    expect(parseMounts("")).toEqual([]);
    expect(parseMounts("garbage\n")).toEqual([]);
  });
});
