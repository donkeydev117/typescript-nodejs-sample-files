import React, { useState } from "react";
import { useQuery, gql } from "@apollo/client";
import _ from "lodash";
import { Grid, Typography } from "@mui/material";

import { ScreenHeader } from "common/ScreenHeader";
import { NoticeStage, UpcomingReviewNotice } from "scheduling";
import { DateTime } from "luxon";
import { Skeleton } from "@mui/material";
import { UpcomingReviewNoticesMonthlyBatch } from "./UpcomingReviewNoticesMonthlyBatch";
import { UpcomingReviewNoticesWithInvalidContactEmails } from "./UpcomingReviewNoticesWithInvalidContactEmails";
import { monthOfYearLongFormat } from "util/formats";
import EditUpcomingReviewNoticeDialog from "./EditUpcomingReviewNoticeDialog";
import { Helmet } from "react-helmet";
import { makeStyles } from "../makeStyles";

export const GetUpcomingReviewNotices = gql`
  query GetUpcomingReviewNotices($stage: NoticeStage!) {
    upcomingReviewNotices(noticeStage: $stage) {
      id
      practiceReview {
        id
        prNumber
        startDate
        contactName
        contactEmail
        hasValidContactEmail
        reviewType
        hasIncreasedRisk
        firm {
          id
          name
        }
      }
      notes
      noticeHtml
      isReviewedAtGenerateStage
      isReviewedAtApprovalStage
      isGenerated
      isModified
    }
  }
`;

interface Props {
  mode: "approve" | "generate";
}

const useStyles = makeStyles()((theme) => ({
  batchPanel: {
    "&:not(:last-child)": {
      marginBottom: theme.spacing(3)
    }
  }
}));

export const UpcomingReviewNoticesScreen: React.FunctionComponent<Props> = (props) => {
  const { mode } = props;
  const { classes } = useStyles();

  const [editingNotice, setEditingNotice] = useState<UpcomingReviewNotice | null>(null);

  const upcomingReviewNoticesQuery = useQuery<{ upcomingReviewNotices: UpcomingReviewNotice[] }>(GetUpcomingReviewNotices, {
    variables: {
      stage: mode === "approve" ? NoticeStage.ApproveNotices : NoticeStage.GenerateNotices
    }
  });
  const upcomingReviewNotices = upcomingReviewNoticesQuery.data?.upcomingReviewNotices ?? [];
  const noticesWithoutValidContactEmail = upcomingReviewNotices.filter((n) => !n.practiceReview.hasValidContactEmail);
  const noticesWithValidContactEmail = upcomingReviewNotices.filter((n) => n.practiceReview.hasValidContactEmail);
  const orderedNotices = _.orderBy(noticesWithValidContactEmail, (n) => n.practiceReview.startDate);
  const monthlyBatches = _.groupBy(orderedNotices, (sn) => {
    const prDate = DateTime.fromISO(sn.practiceReview.startDate);
    return DateTime.fromObject({ year: prDate.year, month: prDate.month }).toFormat(monthOfYearLongFormat);
  });

  const screenTitle = mode === "approve" ? "Approve Upcoming Review Notices" : "Generate Upcoming Review Notices";

  return (
    <div>
      <Helmet>
        <title>{`${screenTitle} - PRS Online`}</title>
      </Helmet>

      <ScreenHeader title={screenTitle} />

      {upcomingReviewNoticesQuery.loading && !upcomingReviewNoticesQuery.data ? (
        <Grid container direction="column" spacing={3}>
          {[...Array(3)].map((x, index) => (
            <Grid item key={index} xs={12}>
              <Skeleton variant="rectangular" width="100%" height="10rem" />
            </Grid>
          ))}
        </Grid>
      ) : upcomingReviewNotices.length > 0 ? (
        <>
          {mode === "generate" && noticesWithoutValidContactEmail.length > 0 && (
            <UpcomingReviewNoticesWithInvalidContactEmails
              upcomingReviewNotices={noticesWithoutValidContactEmail}
              className={classes.batchPanel}
            />
          )}
          {_.map(monthlyBatches, (notificationBatch, month) => (
            <UpcomingReviewNoticesMonthlyBatch
              type={mode}
              key={month}
              month={month}
              upcomingReviewNotices={notificationBatch}
              className={classes.batchPanel}
              editNotice={(notice) => setEditingNotice(notice)}
            />
          ))}
        </>
      ) : (
        <Typography variant="body1">{`No notices to be ${mode === "generate" ? "generated" : "approved"} or reviewed.`}</Typography>
      )}

      {editingNotice && (
        <EditUpcomingReviewNoticeDialog
          notice={editingNotice}
          noticeStage={props.mode === "approve" ? NoticeStage.ApproveNotices : NoticeStage.GenerateNotices}
          handleClose={() => setEditingNotice(null)}
        />
      )}
    </div>
  );
};
