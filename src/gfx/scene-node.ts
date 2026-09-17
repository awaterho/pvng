// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// NOTE: kept as a prototype-based constructor function, not a real ES class,
// because gfx/base-geom.js, gfx/custom-mesh.js and gfx/label.js (not yet
// converted to TS/real classes) chain-invoke it via `SceneNode.call(this,
// gl)` from within their own constructors as part of the old utils.derive()
// pseudo-inheritance pattern -- a real `class` throws ("cannot be invoked
// without 'new'") if called that way. Revisit once those three convert.
//
// A scene node holds a set of child nodes to be rendered on screen. Later on,
// the SceneNode might grow additional functionality commonly found in a scene
// graph, e.g. coordinate transformations.
//
// Cam/shaderCatalog/style/pass aren't typed precisely yet (their modules are
// later tiers of the TS conversion); BaseGeom and other subclasses override
// draw() with the real per-geometry-type logic.
export interface SceneNode {
  _children: SceneNode[];
  _visible: boolean;
  _name: string;
  _gl: WebGLRenderingContext;
  _order: number;

  order(order?: number): number;
  add(node: SceneNode): void;
  draw(cam: unknown, shaderCatalog: unknown, style: unknown, pass: unknown): void;
  show(): void;
  hide(): void;
  name(name?: string): string;
  destroy(): void;
  visible(): boolean;
}

interface SceneNodeConstructor {
  new (gl: WebGLRenderingContext): SceneNode;
  (this: SceneNode, gl: WebGLRenderingContext): void;
  prototype: SceneNode;
}

const SceneNode = function(this: SceneNode, gl: WebGLRenderingContext) {
  this._children = [];
  this._visible = true;
  this._name = '';
  this._gl = gl;
  this._order = 1;
} as unknown as SceneNodeConstructor;

SceneNode.prototype = {
  order: function(this: SceneNode, order?: number): number {
    if (order !== undefined) {
      this._order = order;
    }
    return this._order;
  },

  add: function(this: SceneNode, node: SceneNode): void {
    this._children.push(node);
  },

  draw: function(
    this: SceneNode, cam: unknown, shaderCatalog: unknown, style: unknown, pass: unknown
  ): void {
    for (let i = 0, e = this._children.length; i !== e; ++i) {
      this._children[i]!.draw(cam, shaderCatalog, style, pass);
    }
  },

  show: function(this: SceneNode): void {
    this._visible = true;
  },

  hide: function(this: SceneNode): void {
    this._visible = false;
  },

  name: function(this: SceneNode, name?: string): string {
    if (name !== undefined) {
      this._name = name;
    }
    return this._name;
  },

  destroy: function(this: SceneNode): void {
    for (let i = 0; i < this._children.length; ++i) {
      this._children[i]!.destroy();
    }
  },

  visible: function(this: SceneNode): boolean {
    return this._visible;
  },
} as SceneNode;

export default SceneNode;
