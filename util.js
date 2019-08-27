_.prototype = function (properties) {
	var fn = properties.constructor || function () {}
	_.extend (fn, properties.globals || {})
	delete properties.constructor
	delete properties.globals
	_.extend (fn.prototype, properties)
	return fn
}

_.extends = function (base, properties) {
	return _.prototype (_.extend ({
		__proto__: base.prototype,
		constructor: function () {
			/* call base constructor */
			base.prototype.constructor.apply (this, arguments)
		}
	}, properties))
}