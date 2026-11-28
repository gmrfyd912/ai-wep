import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

import type { YardCanvasProps } from "./YardCanvasImpl";

/**
 * 내 조선소 지도의 새 그림판 (PC 웹): Skia 를 쓰려면 그리기 파일(canvaskit.wasm)을 먼저 불러와야 함.
 * 파일은 npm install 때 public/ 에 복사됨 (package.json postinstall).
 */
export function YardCanvas(props: YardCanvasProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file: string) => `/${file}` }}
      getComponent={() => import("./YardCanvasImpl")}
      componentProps={props}
    />
  );
}
