// eslint-disable-next-line import/no-unassigned-import
require('#config/env');

const process = require('process');
const { parentPort } = require('worker_threads');

// eslint-disable-next-line import/no-unassigned-import
require('#config/mongoose');

const Graceful = require('@ladjs/graceful');
const dayjs = require('dayjs-with-plugins');
const delay = require('delay');
const mongoose = require('mongoose');
const ms = require('ms');
const parseErr = require('parse-err');

const env = require('#config/env');
const emailHelper = require('#helpers/email');
const config = require('#config');
const logger = require('#helpers/logger');
const setupMongoose = require('#helpers/setup-mongoose');
const Emails = require('#models/emails');
const Domains = require('#models/emails');

const graceful = new Graceful({
  mongooses: [mongoose],
  logger
});

graceful.listen();

(async () => {
  await setupMongoose(logger);

  try {
    //
    // NOTE: if you change this then also update `jobs/send-emails` if necessary
    //
    // get list of all suspended domains
    // and recently blocked emails to exclude
    const now = new Date();
    const [suspendedDomainIds, recentlyBlockedIds] = await Promise.all([
      Domains.distinct('_id', {
        smtp_suspended_sent_at: {
          $exists: true
        }
      }),
      Emails.distinct('_id', {
        updated_at: {
          $gte: dayjs().subtract(1, 'hour').toDate(),
          $lte: now
        },
        rejectedErrors: {
          $elemMatch: {
            date: {
              $gte: dayjs().subtract(1, 'hour').toDate(),
              $lte: now
            },
            'bounceInfo.category': 'blocklist',
            'mx.localHostname': env.SMTP_HOST
          }
        }
      })
    ]);

    logger.info('%d suspended domain ids', suspendedDomainIds.length);

    logger.info('%d recently blocked ids', recentlyBlockedIds.length);
    //
    // check the unique ids for emails in the queue
    // if the list is still the same after 1 minute
    // then email admins and throw an error
    //

    // NOTE: if you change this then also update `jobs/send-emails` if necessary
    const query = {
      _id: { $nin: recentlyBlockedIds },
      locked_at: {
        $exists: false
      },
      status: 'queued',
      domain: {
        $nin: suspendedDomainIds
      },
      date: {
        $lte: now
      }
    };

    const ids = await Emails.distinct('id', query);

    // if no ids then return early
    if (ids.length === 0) {
      logger.info('No ids found');
      process.exit(0);
      return;
    }

    // wait 1 minute
    await delay(ms('1m'));

    // check if ids is the same
    const newIds = await Emails.distinct('id', {
      ...query,
      date: {
        $lte: new Date()
      }
    });

    // if no ids then return early
    if (newIds.length === 0) {
      logger.info('No new ids found');
      process.exit(0);
      return;
    }

    if (ids.sort().join(',') === newIds.sort().join(','))
      throw new Error('Queue is frozen');
  } catch (err) {
    await logger.error(err);
    // send an email to admins of the error
    await emailHelper({
      template: 'alert',
      message: {
        to: config.email.message.from,
        subject: 'SMTP Queue Frozen'
      },
      locals: {
        message: `<pre><code>${JSON.stringify(
          parseErr(err),
          null,
          2
        )}</code></pre>`
      }
    });
    // only send one of these emails every 1 hour
    // (this prevents the job from exiting)
    await delay(ms('1h'));
  }

  if (parentPort) parentPort.postMessage('done');
  else process.exit(0);
})();