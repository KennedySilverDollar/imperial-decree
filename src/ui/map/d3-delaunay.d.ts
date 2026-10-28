// d3-delaunay 6（ISC、AA-03 で承認済み）のうち、ParcelMapper が使う範囲だけの型宣言。
// @types/d3-delaunay は別の依存になるので入れない（DECISIONS BC-15）。
declare module "d3-delaunay" {
  export class Voronoi {
    cellPolygon(i: number): [number, number][] | null;
  }
  export class Delaunay {
    static from(points: ArrayLike<readonly [number, number]>): Delaunay;
    voronoi(bounds: [number, number, number, number]): Voronoi;
  }
}
