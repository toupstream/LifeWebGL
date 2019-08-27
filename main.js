var debug = false

Life = _.extends (Viewport, {
	init: function () {
		_.extend (this, {
			randomNoiseShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-random-noise-fs',
				attributes: ['position'],
				uniforms: ['seed']
			}),
			iterationShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-iteration-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'rulesOffset', 'screenSpace', 'pixelOffset', 'rules', 'activeRules', 'swirlFactor']
			}),
			drawCellsShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'draw-cells-fs',
				attributes: ['position'],
				uniforms: ['cells', 'transform']
			}),
			/* square mesh */
			square: this.vertexBuffer ({
				type: this.gl.TRIANGLE_STRIP,
				vertices: [
			         1.0,  1.0,  0.0,
			        -1.0,  1.0,  0.0,
			         1.0, -1.0,  0.0,
			        -1.0, -1.0,  0.0
		        ]
			}),
			rulesBuffer: this.texture ({
				width: 16,
				height: 1,
				data: this.genRulesBufferData (this.rules = [0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
			}),
			/* buffers */
			cellBuffer: null, 												// current
			cellBuffer1: this.renderTexture ({ width: debug ? 512 : 1024, height: 512 }),	// back
			cellBuffer2: this.renderTexture ({ width: debug ? 512 : 1024, height: 512 }),	// front
			brushBuffer: this.renderTexture ({ width: 16, height: 16 }),	// clone stamp
			/* transform matrices */
			transform: new Transform (),
			// screenTransform: new Transform (),
			/* changeable parameters */
			scrollSpeed: debug ? 0.0 : 2.0,
			// brushSize: 16.0,
			// patternBrushScale: 1.0,
			// paused: false,
			// brushType: 'noise',
			/* other stuff */
			// firstFrame: true
		})
		this.cellBuffer = this.cellBuffer1
		this.fillWithRandomNoise ()
		this.initUserInput ()
	},
	genRulesBufferData: function (input) {
		return new Uint8Array (_.flatten (_.map (input, function (i) {
			return i == 2 ? [0,255,0,0] : (i == 1 ? [0,0,0,0] : [255,0,0,0])
		})))
	},
	initUserInput: function () {
		$(this.canvas).mousewheel ($.proxy (this.onZoom, this))
		$(this.canvas).mousedown ($.proxy (function (e) {
			if (!e.button) {
				if (!this.isCloning) {
					this.onPaintStart (e)
				}
			} else {
				this.onDragStart (e)
			}
		}, this))
		$(this.canvas).bind ('contextmenu', function (e) {
			e.preventDefault ()
		})
		$(this.canvas).mousemove ($.proxy (function (e) {
			this.cloneStampPosition = this.eventPoint (e)
		}, this))
		$(window).keydown ($.proxy (function (e) {
			switch (e.keyCode) {
				case 18: /* alt */
					if (!this.isPainting) {
						this.onCloneStart (e);
					}
					break;
				case 82: /* r */ this.setBrushType ('round'); break;
				case 78: /* n */ this.setBrushType ('noise'); break;
				case 32: /* space */ this.paused = !this.paused; break;
				case 27: /* esc */ this.reset ('nothing'); $('.controls .scroll-speed').slider ('value', this.scrollSpeed = 0); break;
			}
		}, this))
		$(window).resize ($.proxy (function () {
			var container = $('.viewport-container')
			var width = container.width (),
				height = container.height ()
			if (width >= this.cellBuffer.width && height >= this.cellBuffer.height) {
				this.resize (this.cellBuffer.width, this.cellBuffer.height)
			} else {
				this.resize (width, height)
			}
		}, this)).resize ()
	},
	getZoom: function () {
		return vec3.length (vec3.subtract (
				this.transform.apply ([0, 0, 0]),
				this.transform.apply ([1, 0, 0])))
	},
	fillWithRandomNoise: function () {
		this.cellBuffer.draw (function () {
			this.randomNoiseShader.use ()
			this.randomNoiseShader.attributes.position.bindBuffer (this.square)
			this.randomNoiseShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.square.draw ()
		}, this)
		this.firstFrame = true
	},
	springDynamics: function () {
		var zoom = this.getZoom ()
		if (!this.isDragging) {
			if (zoom > 0.99) {
				var center = this.transform.apply ([0, 0, 0])
				var springForce = [
					(Math.max (0, Math.abs(center[0]) - (zoom - 1))) / zoom,
					(Math.max (0, Math.abs(center[1]) - (zoom - 1))) / zoom]
				this.updateTransform (this.transform.translate ([
					(Math.pow (1.2, springForce[0]) - 1.0) * (center[0] > 0 ? -1 : 1),
					(Math.pow (1.2, springForce[1]) - 1.0) * (center[1] > 0 ? -1 : 1), 0.0]))
			} else {
				this.updateTransform (this.transform.translate (this.transform.applyInverse ([0, 0, 0])))
			}
		}
		if (zoom < 1.0) {
			var springForce = Math.pow (1.2, 1.0 - zoom)
			this.updateTransform (this.transform.scale ([springForce, springForce, 1.0]))
		}
	},
	updateTransform: function (newTransform) {
		var viewportTransform = new Transform ()
		var aspect = this.viewportWidth / this.viewportHeight
		var bufferAspect = this.cellBuffer.width / this.cellBuffer.height
		if (this.cellBuffer.width < this.viewportWidth && this.cellBuffer.height < this.viewportHeight) {
			viewportTransform = viewportTransform.scale ([
				this.cellBuffer.width / this.viewportWidth,
				this.cellBuffer.height / this.viewportHeight, 1.0])
		} else {
			viewportTransform = viewportTransform.scale (this.cellBuffer.width > this.cellBuffer.height
				? [1.0, aspect / bufferAspect, 1.0]
				: [bufferAspect / aspect, 1.0, 1.0])
		}
		this.transform = newTransform || this.transform
		this.screenTransform = this.transform.multiply (viewportTransform)
	},
	beforeDraw: function () {
		if (!this.paused) {
			if (this.shouldPaint) {
				this.paint (true)
			} else {
				this.iterate ()
			}
		} else if (this.shouldPaint) {
			this.paint (false)
		}
		if (this.isCloning) {
			this.updateBrushBuffer ()
		}
		this.springDynamics ()
	},
	renderCells: function (callback) {
		/* backbuffering */
		var targetBuffer = (this.cellBuffer == this.cellBuffer1 ? this.cellBuffer2 : this.cellBuffer1)
		targetBuffer.draw (callback, this)
		this.cellBuffer = targetBuffer
		this.firstFrame = false
	},
	iterate: function () {
		this.renderCells (function () {
			this.iterationShader.use ()
			this.iterationShader.attributes.position.bindBuffer (this.square)
			this.iterationShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0)
			this.iterationShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
			this.iterationShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.iterationShader.uniforms.pixelOffset.set2f (
				0.0 / this.cellBuffer.width,
				-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height)
		    this.square.draw ()
		})
	},
	draw: function () {
		this.gl.disable (this.gl.DEPTH_TEST)
		this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		this.drawCellsShader.use ()
		this.drawCellsShader.attributes.position.bindBuffer (this.square)
		this.drawCellsShader.uniforms.transform.setMatrix (this.screenTransform)
		this.drawCellsShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
		this.square.draw ()
		this.drawCloneStamp ()
	},
	drawCloneStamp: function () {
		if (this.isCloning) {
			this.brushCursorShader.use ()
			this.brushCursorShader.attributes.position.bindBuffer (this.square)
			this.brushCursorShader.uniforms.transform.setMatrix (new Transform ()
				.translate (this.cloneStampPosition)
				.scale ([this.brushBuffer.width / this.cellBuffer.width, this.brushBuffer.height / this.cellBuffer.height, 0.0])
				.multiply (this.screenTransform))
			this.brushCursorShader.uniforms.color.bindTexture (this.brushBuffer, 0)
			this.square.draw ()
		}
	},
})

$(document).ready (function () {
	var life = new Life ({
		canvas: $('.viewport').get (0)
	})
})