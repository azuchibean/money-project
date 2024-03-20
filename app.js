var createError = require('http-errors');
var express = require('express');
const session = require('express-session');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var { fetchExchangeRate, fetchLastSevenDays } = require('./db');

require('dotenv').config();

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');


var app = express();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// POST for button
app.post('/query', async (req, res) => {
  const fromCurrency = req.body.fromCurrency;
  const toCurrency = req.body.toCurrency;

  const exchangeRate = await fetchExchangeRate(fromCurrency, toCurrency);

  res.json({ exchangeRate });
});

// POST for table
app.post('/getTableData', async (req, res) => {
  const fromCurrency = req.body.selectedOption1;
  const toCurrency = req.body.selectedOption2;

  const exchangeRates = await fetchLastSevenDays(fromCurrency, toCurrency);

  res.json({ exchangeRates });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});





const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;
