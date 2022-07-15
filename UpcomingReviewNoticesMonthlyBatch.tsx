import React from "react";
import { NoticeStage, UpcomingReviewNotice } from "./models";
import _ from "lodash";
import { DataGridWithHeader } from "common/DataGridWithHeader";
import { dataGridDateValueFormatter, monthOfYearLongFormat } from "util/formats";
import { Checkbox, IconButton, Link, Tooltip } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit } from "@fortawesome/free-solid-svg-icons/faEdit";
import { gql, useMutation } from "@apollo/client";
import { useNotifications } from "notifications";
import { DateTime } from "luxon";
import { Link as RouterLink } from "react-router-dom";
import { getRouteForPracticeReview } from "practice-reviews/PracticeReviewScreen";
import { GetUpcomingReviewNotices } from "./UpcomingReviewNoticesScreen";
import { datagridStyles } from "styles/common";
import { LoadingButton } from "@mui/lab";
import { makeStyles } from "../makeStyles";
import { GridColDef, GridSortCellParams } from "@mui/x-data-grid-pro";
import PrLink from "../common/PrLink";

const useStyles = makeStyles()((theme) => ({
  ...datagridStyles(theme),
  noPaddingCell: {
    padding: 0
  },
  notesCell: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis"
  }
}));

interface Props {
  type: "approve" | "generate";
  month: string;
  upcomingReviewNotices: UpcomingReviewNotice[];
  editNotice: (upcomingReviewNotice: UpcomingReviewNotice) => void;
  className?: string;
}

export const UpcomingReviewNoticesMonthlyBatch: React.FunctionComponent<Props> = (props) => {
  const { classes } = useStyles();

  const notifications = useNotifications();

  const regenerating = props.upcomingReviewNotices.every((sn) => sn.isGenerated);

  const [generateMutate, generateMutation] = useMutation<
    { upcomingReviewNotice: { generate: Partial<UpcomingReviewNotice>[] } },
    {
      upcomingReviewNoticeIds: number[];
      fromDate: string;
      toDate: string;
    }
  >(
    gql`
      mutation GenerateUpcomingReviewNotices($upcomingReviewNoticeIds: [Int]!, $fromDate: Date!, $toDate: Date!) {
        upcomingReviewNotice {
          generate(upcomingReviewNoticeIds: $upcomingReviewNoticeIds, fromDate: $fromDate, toDate: $toDate) {
            id
            noticeHtml
            isGenerated
            isModified
          }
        }
      }
    `
  );

  async function generate() {
    const noticeIdsToGenerate = props.upcomingReviewNotices
      .filter((sn) => !sn.isGenerated || !sn.isReviewedAtGenerateStage)
      .map((sn) => sn.id);
    const fromDate = DateTime.fromFormat(props.month, monthOfYearLongFormat);
    const toDate = fromDate.plus({ months: 1 }).plus({ days: -1 });

    const generateResult = await generateMutate({
      variables: {
        upcomingReviewNoticeIds: noticeIdsToGenerate,
        fromDate: fromDate.toISODate(),
        toDate: toDate.toISODate()
      }
    });

    if (generateResult.data?.upcomingReviewNotice.generate) {
      notifications.success(regenerating ? "Notices regenerated." : "Notices generated.");
    }
  }

  const [releaseForApprovalMutate, releaseForApprovalMutation] = useMutation<
    { upcomingReviewNotice: { releaseForApproval: Partial<UpcomingReviewNotice>[] } },
    {
      upcomingReviewNoticeIds: number[];
    }
  >(
    gql`
      mutation ReleaseUpcomingReviewNoticesForApproval($upcomingReviewNoticeIds: [Int]!) {
        upcomingReviewNotice {
          releaseForApproval(upcomingReviewNoticeIds: $upcomingReviewNoticeIds) {
            id
          }
        }
      }
    `,
    {
      refetchQueries: [
        {
          query: GetUpcomingReviewNotices,
          variables: {
            stage: NoticeStage.GenerateNotices
          }
        },
        {
          query: GetUpcomingReviewNotices,
          variables: {
            stage: NoticeStage.ApproveNotices
          }
        },
        "GetInasForCurrentUser"
      ]
    }
  );

  async function releaseForApproval() {
    const noticeIdsToRelease = props.upcomingReviewNotices.filter((n) => n.isReviewedAtGenerateStage).map((n) => n.id);

    const releaseForApprovalResult = await releaseForApprovalMutate({
      variables: {
        upcomingReviewNoticeIds: noticeIdsToRelease
      }
    });

    const updatedReviewNotices = releaseForApprovalResult.data?.upcomingReviewNotice.releaseForApproval;
    if (updatedReviewNotices) {
      notifications.success(`${updatedReviewNotices.length} notice${updatedReviewNotices.length !== 1 ? "s" : ""} released for approval.`);
    }
  }

  const [approveNoticesMutate, approveNoticesMutation] = useMutation<
    { upcomingReviewNotice: { approveNotices: Partial<UpcomingReviewNotice>[] } },
    {
      upcomingReviewNoticeIds: number[];
    }
  >(
    gql`
      mutation ApproveNotices($upcomingReviewNoticeIds: [Int]!) {
        upcomingReviewNotice {
          approveNotices(upcomingReviewNoticeIds: $upcomingReviewNoticeIds) {
            id
          }
        }
      }
    `,
    {
      refetchQueries: [
        {
          query: GetUpcomingReviewNotices,
          variables: {
            stage: NoticeStage.ApproveNotices
          }
        },
        "GetInasForCurrentUser"
      ]
    }
  );

  async function approveNotices() {
    const noticeIdsToApprove = props.upcomingReviewNotices.filter((n) => n.isReviewedAtApprovalStage).map((n) => n.id);

    const approveNoticesResult = await approveNoticesMutate({
      variables: {
        upcomingReviewNoticeIds: noticeIdsToApprove
      }
    });

    const updatedReviewNotices = approveNoticesResult.data?.upcomingReviewNotice.approveNotices;
    if (updatedReviewNotices) {
      notifications.success(`${updatedReviewNotices.length} notice${updatedReviewNotices.length !== 1 ? "s" : ""} approved.`);
    }
  }

  const [toggleReviewedMutate] = useMutation<
    {
      upcomingReviewNotice: {
        toggleReviewed: Partial<UpcomingReviewNotice>;
        __typename?: string;
      };
    },
    {
      upcomingReviewNoticeId: number;
      stage: NoticeStage;
    }
  >(
    gql`
      mutation ToggleNoticeReviewed($upcomingReviewNoticeId: Int!, $stage: NoticeStage!) {
        upcomingReviewNotice {
          toggleReviewed(upcomingReviewNoticeId: $upcomingReviewNoticeId, noticeStage: $stage) {
            id
            isReviewedAtGenerateStage
            isReviewedAtApprovalStage
          }
        }
      }
    `
  );

  async function toggleNoticeReviewed(upcomingReviewNotice: UpcomingReviewNotice, noticeStage: NoticeStage) {
    await toggleReviewedMutate({
      variables: {
        upcomingReviewNoticeId: upcomingReviewNotice.id,
        stage: noticeStage
      },
      optimisticResponse: {
        upcomingReviewNotice: {
          toggleReviewed: {
            ...upcomingReviewNotice,
            isReviewedAtGenerateStage:
              noticeStage === NoticeStage.GenerateNotices
                ? !upcomingReviewNotice.isReviewedAtGenerateStage
                : upcomingReviewNotice.isReviewedAtGenerateStage,
            isReviewedAtApprovalStage:
              noticeStage === NoticeStage.ApproveNotices
                ? !upcomingReviewNotice.isReviewedAtApprovalStage
                : upcomingReviewNotice.isReviewedAtApprovalStage
          },
          __typename: ""
        }
      }
    });
  }

  const columns: GridColDef[] = [
    {
      field: "practiceReview.prNumber",
      headerName: "PR No.",
      width: 80,
      renderCell: (params) => <PrLink practiceReview={(params.row as UpcomingReviewNotice).practiceReview} />,
      disableColumnMenu: true,
      sortComparator: (v1, v2, param1: GridSortCellParams, param2: GridSortCellParams) =>
        param1.api.getRow(param1.id)!.practiceReview.prNumber.localeCompare(param2.api.getRow(param2.id)!.practiceReview.prNumber)
    },
    {
      field: "practiceReview.firm.name",
      headerName: "Firm",
      flex: 5,
      valueGetter: (params) => (params.row as UpcomingReviewNotice).practiceReview.firm.name
    },
    {
      field: "practiceReview.contactName",
      headerName: "PR Contact",
      flex: 3,
      valueGetter: (params) => (params.row as UpcomingReviewNotice).practiceReview.contactName
    },
    {
      field: "practiceReview.contactEmail",
      headerName: "Email",
      flex: 4,
      valueGetter: (params) => (params.row as UpcomingReviewNotice).practiceReview.contactEmail
    },
    {
      field: "practiceReview.reviewType",
      headerName: "Type",
      width: 140,
      valueGetter: (params) => (params.row as UpcomingReviewNotice).practiceReview.reviewType
    },
    {
      field: "practiceReview.startDate",
      headerName: "Tentative Review Date",
      headerClassName: classes.wrapHeader,
      type: "date",
      width: 120,
      valueGetter: (params) => (params.row as UpcomingReviewNotice).practiceReview.startDate,
      valueFormatter: dataGridDateValueFormatter
    },
    {
      field: "notes",
      headerName: "Notes",
      flex: 10,
      width: 300,
      renderCell: (params) => {
        const notice = params.row as UpcomingReviewNotice;
        return (
          <Tooltip title={notice.notes ?? ""} className={classes.notesCell}>
            <div>{notice.notes}</div>
          </Tooltip>
        );
      }
    },
    {
      headerName: "Modified",
      type: "boolean",
      field: "isModified",
      width: 100,
      hide: props.type === "generate"
    },
    {
      field: "actions",
      renderHeader: () => <div />,
      cellClassName: classes.noPaddingCell,
      width: 40,
      align: "center",
      renderCell: (params) => {
        const notice = params.row as UpcomingReviewNotice;
        return (
          <IconButton
            color="primary"
            size="small"
            onClick={() => {
              props.editNotice(notice);
            }}
            disabled={!notice.isGenerated}>
            <FontAwesomeIcon icon={faEdit} />
          </IconButton>
        );
      }
    },
    {
      field: props.type === "approve" ? "isReviewedAtApprovalStage" : "isReviewedAtGenerateStage",
      headerName: "Reviewed",
      width: 100,
      align: "center",
      renderCell: (params) => {
        const notice = params.row as UpcomingReviewNotice;
        return (
          <Checkbox
            checked={props.type === "approve" ? notice.isReviewedAtApprovalStage : notice.isReviewedAtGenerateStage}
            disabled={!notice.isGenerated}
            onClick={() =>
              toggleNoticeReviewed(notice, props.type === "approve" ? NoticeStage.ApproveNotices : NoticeStage.GenerateNotices)
            }
          />
        );
      }
    }
  ];

  const sortedNotices = _.orderBy(props.upcomingReviewNotices, (sn) => sn.practiceReview.startDate);

  return (
    <DataGridWithHeader
      title={props.month}
      itemType={`${props.month} notices to be generated`}
      columns={columns}
      rows={sortedNotices}
      className={props.className}
      collapsible
      headerActions={
        props.type === "generate" && (
          <LoadingButton
            onClick={() => generate()}
            variant="outlined"
            color="primary"
            size="small"
            disabled={props.upcomingReviewNotices.every((sn) => sn.isGenerated && sn.isReviewedAtGenerateStage)}
            loading={generateMutation.loading}>
            {regenerating ? "Regenerate" : "Generate"}
          </LoadingButton>
        )
      }
      footerActions={
        <LoadingButton
          onClick={() => (props.type === "approve" ? approveNotices() : releaseForApproval())}
          variant="outlined"
          color="primary"
          size="small"
          disabled={
            props.type === "approve"
              ? props.upcomingReviewNotices.every((n) => !n.isReviewedAtApprovalStage)
              : props.upcomingReviewNotices.every((n) => !n.isReviewedAtGenerateStage)
          }
          loading={props.type === "approve" ? approveNoticesMutation.loading : releaseForApprovalMutation.loading}>
          {props.type === "generate" && "Release for Approval"}
          {props.type === "approve" && "Approve Notices"}
        </LoadingButton>
      }
    />
  );
};
